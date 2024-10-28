import crypto from 'crypto'
import { utilSha512 } from '../../src'

/*
 * Copyright 2014-2021 Justin Pauli, all rights reserved.
 */
export enum CryptoScheme {
    MOCK = 'MOCK',
    ED25519 = 'ED',
    FourQ = '4Q',
}

export interface SchnorrSignature {
    type: string
    data: Buffer
}

export interface SchnorrKeyPair {
    isSchnorr: boolean
    type: CryptoScheme
    publicKey: Buffer
    secretKey: Buffer
}

export interface DiffieHellmanKeyPair {
    isDH: boolean
    type: CryptoScheme
    publicKey: Buffer
    secretKey: Buffer
}

export interface IdentityKeyPair {
    isIdentity: boolean
    type: CryptoScheme
    publicKeySchnorr: Buffer
    publicKeyECDH: Buffer
    secretKey: Buffer
}

export type BufferLike = Buffer | string

export interface CryptoLibIface {
    // Schnorr Variety (Generate, Sign, Verify)
    generateKeyPair: () => SchnorrKeyPair
    generateFromSeed: (seed?: BufferLike) => SchnorrKeyPair
    sign: (message: BufferLike, secretKey: BufferLike) => SchnorrSignature
    verify: (
        signature: BufferLike,
        message: BufferLike,
        publicKey: BufferLike,
    ) => boolean

    // Diffie-Hellman Variety (Generate, GetSharedSecret)
    dhGenerateKeyPair: () => DiffieHellmanKeyPair
    dhGenerateFromSeed: (seed?: BufferLike) => DiffieHellmanKeyPair
    getSharedSecret: (
        mySecret: BufferLike,
        theirPublicKey: BufferLike,
    ) => Buffer

    // Identity
    generateIdentity: (seed?: BufferLike) => IdentityKeyPair
}

export class CryptoUtil {
    static STRING_MODE_TEXT = 0
    static STRING_MODE_BASE64 = 1
    static STRING_MODE_HEX = 2

    unsafeBuffers = false
    bufferStringMode = CryptoUtil.STRING_MODE_BASE64

    seedBytes(seed: BufferLike): Buffer {
        return this.toBuffer(seed)
    }

    randomBytes(length: number = 32): Buffer {
        return this.toBuffer(crypto.randomBytes(length))
    }

    toBuffer(a: BufferLike): Buffer {
        if (!a) {
            return null
        }
        if (Buffer.isBuffer(a)) {
            if (this.unsafeBuffers) {
                return a
            }
            const b = Buffer.allocUnsafeSlow(a.length)
            a.copy(b)
            return b
        }
        if (typeof a === 'string') {
            if (this.bufferStringMode === CryptoUtil.STRING_MODE_BASE64) {
                a = Buffer.from(a, 'base64')
            } else if (this.bufferStringMode === CryptoUtil.STRING_MODE_HEX) {
                a = Buffer.from(a, 'hex')
            } else {
                a = Buffer.from(a)
            }
            if (this.unsafeBuffers) {
                return a
            }
            const b = Buffer.allocUnsafeSlow(a.length)
            a.copy(b)
            return b
        }
        throw new Error('Unknown type supplied.')
    }
}

export class XorCrypt {
    util: CryptoUtil
    sha512Provider: (
        mask: ArrayBufferLike,
        content: ArrayBufferLike,
    ) => Uint8Array

    constructor(
        util: CryptoUtil,
        sha512Provider: (
            mask: ArrayBufferLike,
            content: ArrayBufferLike,
        ) => Uint8Array,
    ) {
        this.util = util
        this.sha512Provider = sha512Provider
    }

    sha512(cypherBuffer64Byte: BufferLike, content: BufferLike): Buffer {
        const a: Buffer = this.util.toBuffer(cypherBuffer64Byte)
        if (a.length !== 64) {
            throw new Error('Your cypherBuffer must be 64-byte')
        }
        const b: Buffer = this.util.toBuffer(content)
        const xorEncrypted = this.sha512Provider(a.buffer, b.buffer)
        return Buffer.from(xorEncrypted)
    }
}

export class CryptoProvider {
    lib: CryptoLibIface
    util: CryptoUtil
    xorCrypt: XorCrypt
}

class MockCryptoLib implements CryptoLibIface {
    static mockPublicKey = 'a59GffwS8Z5s4aBsnsQscp/hgEfkWm2gJgBMNNQ3yTQ='
    util: CryptoUtil
    constructor(util?: CryptoUtil) {
        if (util) {
            this.util = util
        } else {
            this.util = new CryptoUtil()
        }
    }
    // Schnorr Variety (Generate, Sign, Verify)
    generateKeyPair(): SchnorrKeyPair {
        return {
            isSchnorr: true,
            type: CryptoScheme.MOCK,
            publicKey: this.util.randomBytes(32),
            secretKey: this.util.randomBytes(32),
        }
    }
    generateFromSeed(seed?: BufferLike): SchnorrKeyPair {
        return {
            isSchnorr: true,
            type: CryptoScheme.MOCK,
            publicKey: Buffer.from(MockCryptoLib.mockPublicKey, 'base64'),
            secretKey: this.util.seedBytes(seed),
        }
    }
    sign(message: BufferLike, secretKey: BufferLike): SchnorrSignature {
        return {
            type: CryptoScheme.FourQ,
            data: Buffer.from(this.util.randomBytes(64)),
        }
    }
    verify(
        signature: BufferLike,
        message: BufferLike,
        publicKey: BufferLike,
    ): boolean {
        return true
    }

    // Diffie-Hellman Variety (Generate, GetSharedSecret)
    dhGenerateKeyPair(): DiffieHellmanKeyPair {
        return {
            isDH: true,
            type: CryptoScheme.MOCK,
            publicKey: this.util.randomBytes(32),
            secretKey: this.util.randomBytes(32),
        }
    }
    dhGenerateFromSeed(seed?: BufferLike): DiffieHellmanKeyPair {
        return {
            isDH: true,
            type: CryptoScheme.MOCK,
            publicKey: Buffer.from(MockCryptoLib.mockPublicKey, 'base64'),
            secretKey: this.util.seedBytes(seed),
        }
    }
    getSharedSecret(mySecret: BufferLike, theirPublicKey: BufferLike): Buffer {
        const zeroedOut = new Uint8Array(32)
        for (let i = 0; i < 32; ++i) {
            zeroedOut[i] = 0
        }
        return Buffer.from(zeroedOut)
    }

    // Identity
    generateIdentity(seed?: BufferLike): IdentityKeyPair {
        if (!seed) {
            seed = crypto.randomBytes(32)
        }
        const secretKeyBuffer: Buffer = this.util.toBuffer(seed)
        const schnorrKeypair = this.generateFromSeed(seed)
        const ecdhKeypair = this.dhGenerateFromSeed(seed)
        return {
            isIdentity: true,
            type: CryptoScheme.FourQ,
            publicKeySchnorr: schnorrKeypair.publicKey,
            publicKeyECDH: ecdhKeypair.publicKey,
            secretKey: secretKeyBuffer,
        }
    }
}

export class DefaultCryptoProvider extends CryptoProvider {
    constructor() {
        super()
        this.util = new CryptoUtil()
        this.xorCrypt = new XorCrypt(this.util, (a, b) => new Uint8Array(b))
        this.lib = new MockCryptoLib(this.util)
    }
}

const defaultCryptoProviderSetting = {
    provider: new DefaultCryptoProvider(),
}

export function getDefaultCryptoLibProvider() {
    return defaultCryptoProviderSetting.provider
}

export function setDefaultCryptoLibProvider(v: CryptoProvider) {
    if (!v) {
        return
    }
    defaultCryptoProviderSetting.provider = v
}
