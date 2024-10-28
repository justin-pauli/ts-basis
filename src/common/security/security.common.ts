export enum SecureChannelTypes {
    NONE = 'NONE',
    DEFAULT = 'ECC_4Q',
    ECC_4Q = 'ECC_4Q',
}

export type ResolvableEntry<T = string, S = string> =
    | T
    | {
          list?: {
              [key: string]: {
                  type?: S
                  value?: T
                  getter?: (key: string) => T | Promise<T>
              }
          }
          getter?: (key: string) => T | Promise<T>
      }

export interface TrustedPublicKey {
    type: keyof typeof SecureChannelTypes
    publicKey: string
}

export interface SecureChannelBaseParams {
    user?: string
    token: ResolvableEntry
    trust?: ResolvableEntry<TrustedPublicKey>
    signing?: AuthSigning
    expire?: number
}

export interface AccessHeaderObject {
    headerLength: any
    accessorBuffer: Buffer
    timeHex: string
    timeBuffer: Buffer
    timestamp: number
    nonceHex: string
    nonceBuffer: Buffer
    oneTimeHash: string
}

export interface AuthHeaderObject extends AccessHeaderObject {
    accessorExpression: string
    peerEcdhPublicKey: string
    expires: number
    sigPart: string
    peerSignaturePublicKey: string
    peerSignature: string
    peerSignaturePayload: string
}

export interface AuthSigning {
    type: string
    public: string
    private: string
}

export interface AuthSignatureData {
    payload: string
    sig: string
}

export interface SecureChannelPeer {
    type?: SecureChannelTypes
    ecdhPublicKey: Buffer
    signaturePublicKey?: Buffer
    iden?: any
    data?: any
}

export interface SecureChannelPayload {
    /** SecureChannelPayload flag */
    __scp: boolean
    /** channelId */
    c: string
    /** nonce in base64 (unique each payload) */
    n: string
    /** encrypted payload in base64 */
    p: string
}

export interface SecureChannelResponse {
    payload: string
    sig: string
    channelId?: string
    ecdhPublicKey: string
    signaturePublicKey: string
    extra?: SecureChannelResponseExtraInfo
}
export interface SecureChannelResponseExtraInfo {
    remoteAddress?: string
}

export type x509FingerprintType = 'SHA-1' | 'SHA-256' | 'SHA-512'
export type EcNamedCurves = 'P-256' | 'P-384' | 'P-512'
export type EcRootType = 'ECDSA' | '4Q'
export type AsymmetricAlgorithmKind = 'RSA' | 'EC'
