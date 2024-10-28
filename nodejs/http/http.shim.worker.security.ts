/*
 * Copyright 2014-2021 Justin Pauli, all rights reserved.
 */
import { SecureChannelPeer } from '../../src/common/security/security.common'
import {
    CryptoProvider,
    getDefaultCryptoLibProvider,
} from '../crypto/crypto.util.iface'
import {
    AsyncWorkerClient,
    AsyncWorkerExecutor,
} from '../proc/async.worker.proc'
import {
    SecureChannel,
    SecureHandshake,
} from '../secure-channel/secure-channel'

export class SecureChannelWorkerClient extends AsyncWorkerClient {
    static workerFile = __filename
    constructor(workerData: any) {
        super(workerData, { workerFile: SecureChannelWorkerClient.workerFile })
    }
    signMessage(msgBase64: string) {
        return this.call<string>(`signMessage`, msgBase64, r => r)
    }
    newChannel(peerInfo: SecureChannelPeer) {
        const peerInfoEncoded = JSON.stringify({
            ecdhPublicKey: peerInfo.ecdhPublicKey.toString('base64'),
            iden: peerInfo.iden,
            data: peerInfo.data,
        })
        return this.call<SecureChannel>(`newChannel`, peerInfoEncoded, r =>
            SecureHandshake.fromJSON(r),
        )
    }
}
const thisWorkerClass = SecureChannelWorkerClient

export class SecureChannelWorkerLogic extends AsyncWorkerExecutor {
    cryptoProvider: CryptoProvider = getDefaultCryptoLibProvider()
    signingKey: Buffer
    constructor(workerData: any) {
        super(workerData)
        this.signingKey = Buffer.from(workerData.signingKey, 'base64')
        this.setAsReady()
    }
    async handleAction(callId: string, action: string, payload?: string) {
        switch (action) {
            case 'signMessage': {
                const sig = this.cryptoProvider.lib.sign(
                    Buffer.from(payload, 'base64'),
                    this.signingKey,
                )
                return this.returnCall(callId, sig.data.toString('base64'))
            }
            case 'newChannel': {
                const peerInfo: SecureChannelPeer = JSON.parse(payload)
                peerInfo.ecdhPublicKey = Buffer.from(
                    peerInfo.ecdhPublicKey as unknown as string,
                    'base64',
                )
                const channel = new SecureChannel(
                    peerInfo.type,
                    'generate',
                    JSON.parse(payload),
                    null,
                    {
                        type: '4Q',
                        public: '',
                        private: this.signingKey.toString('base64'),
                    },
                )
                return this.returnCall(callId, channel.toJSON())
            }
        }
    }
}

if (process.env.WORKER_DATA_BASE64) {
    const workerData = JSON.parse(
        Buffer.from(process.env.WORKER_DATA_BASE64, 'base64').toString('utf8'),
    )
    if (workerData.workerFile === thisWorkerClass.workerFile) {
        new SecureChannelWorkerLogic(workerData).getSelf()
    }
}
