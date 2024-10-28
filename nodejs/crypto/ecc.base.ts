import crypto, { X509Certificate } from 'crypto'
import {
    EcNamedCurves,
    EcRootType,
    x509FingerprintType,
} from '../../src/common/security/security.common'

type BufferLike = string | Buffer | Uint8Array

export class ECCBase {
    type: EcRootType = 'ECDSA'
    curveName: EcNamedCurves = 'P-384'
    hash: AlgorithmIdentifier = 'SHA-512'

    async generateKeyPair() {
        const keypair = await crypto.subtle.generateKey(
            {
                name: this.type,
                namedCurve: this.curveName,
            },
            true,
            ['sign', 'verify'],
        )
        return keypair
    }

    async getSigningKey(privateKeyFileContent: string) {
        const privateKeyObject = crypto.createPrivateKey({
            key: privateKeyFileContent,
        })
        const keyDerData = privateKeyObject.export({
            type: 'pkcs8',
            format: 'der',
        })
        const signingKey = await crypto.subtle.importKey(
            'pkcs8',
            keyDerData,
            {
                name: this.type,
                namedCurve: this.curveName,
            },
            true,
            ['sign'],
        )
        return signingKey
    }

    async sign(signingKey: CryptoKey, data: BufferLike) {
        const dataU8 = toUint8Array(data)
        const signature = await crypto.subtle.sign(
            {
                name: this.type,
                hash: this.hash,
            },
            signingKey,
            dataU8,
        )
        return new Uint8Array(signature)
    }

    async getPublicKey(publicKeyFileContent: string) {
        const publicKeyObject = crypto.createPublicKey({
            key: publicKeyFileContent,
        })
        const keyDerData = publicKeyObject.export({
            type: 'spki',
            format: 'der',
        })
        const publickKey = await crypto.subtle.importKey(
            'spki',
            keyDerData,
            {
                name: this.type,
                namedCurve: this.curveName,
            },
            true,
            ['verify'],
        )
        return publickKey
    }

    async getPublicKeyFromCert(publicCertFileContent: string) {
        const cert = new X509Certificate(publicCertFileContent)
        const keyDerData = cert.publicKey.export({
            type: 'spki',
            format: 'der',
        })
        const publickKey = await crypto.subtle.importKey(
            'spki',
            keyDerData,
            {
                name: this.type,
                namedCurve: this.curveName,
            },
            true,
            ['verify'],
        )
        return publickKey
    }

    async getCertificateFingerprint(
        publicCertFileContent: string,
        type: x509FingerprintType = 'SHA-1',
    ) {
        const cert = new X509Certificate(publicCertFileContent)
        if (type === 'SHA-1') {
            return cert.fingerprint
        } else if (type === 'SHA-256') {
            return cert.fingerprint256
        } else if (type === 'SHA-512') {
            return cert.fingerprint512
        }
    }

    validateCertAndKey(
        publicCertFileContent: string,
        privateKeyFileContent: string,
    ) {
        const cert = new X509Certificate(publicCertFileContent)
        const signingKey = crypto.createPrivateKey({
            key: privateKeyFileContent,
        })
        return cert.checkPrivateKey(signingKey)
    }

    async verify(
        publicKey: CryptoKey,
        signature: BufferLike,
        data: BufferLike,
    ) {
        const sigU8 = toUint8Array(signature)
        const dataU8 = toUint8Array(data)
        return await crypto.subtle.verify(
            {
                name: this.type,
                hash: this.hash,
            },
            publicKey,
            sigU8,
            dataU8,
        )
    }
}

function toUint8Array(bufferLike: BufferLike): Uint8Array {
    if (typeof bufferLike === 'string') {
        return new TextEncoder().encode(bufferLike)
    } else if (bufferLike instanceof Uint8Array) {
        return bufferLike
    } else {
        bufferLike
    }
}
