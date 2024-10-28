import {
    ok,
    passthru,
    Result,
    ReturnCodeFamily,
    utilSha512,
} from '../globals.ix'
import { Codec } from '../util/encoding.util'
import { randBase64Id } from './random.util'
import {
    AsymmetricAlgorithmKind,
    EcNamedCurves,
    EcRootType,
} from './security.common'

type DefaultUserInfoType = { [key: string]: any }

export type BasicUserData<T extends object = DefaultUserInfoType> = {
    id: string
    displayName?: string
    info: T
    roles: string[]
}

export type AdvancedToken = {
    name: string
    nonce: string
    payload: string
    authHash: string
    signature?: Uint8Array
    signedMessage?: Uint8Array
}

export type SigningScheme = {
    kind?: AsymmetricAlgorithmKind
    type?: EcRootType
    curveName?: EcNamedCurves
    publicKey?: string
    publicCert?: string
}

export type AdvancedTokenDetails<T extends object = DefaultUserInfoType> = {
    token?: string
    signingScheme?: SigningScheme
    userdata: BasicUserData<T>
}

type TokenFetcher = (tokenName: string) => Promise<Result<AdvancedTokenDetails>>
type SignatureVerifier = (
    scheme: SigningScheme,
    signature: Uint8Array,
    message: Uint8Array,
) => Promise<Result<boolean>>
type MessageSigner = (
    message: string | Uint8Array,
) => Promise<Result<Uint8Array>>

type AdvancedTokenCreateOption = {
    lengthUnlimited?: boolean
}

enum AdvancedTokenAuthCodeEnum {
    ADV_TOKEN_PARSE_GENERIC_ERROR,
    ADV_TOKEN_PARSE_NAME_NOT_VALID,
    ADV_TOKEN_PARSE_HASH_NOT_VALID,
    ADV_TOKEN_PARSE_PAYLOAD_NOT_VALID,
    TOKEN_CREATE_GENERIC_ERROR,
    TOKEN_CREATE_NO_PAYLOAD,
    TOKEN_CREATE_LENGTH_TOO_LONG,
    TOKEN_CREATE_NO_MESSAGE_SIGNER,
    TOKEN_IS_EMPTY,
    TOKEN_FETCHER_NOT_FOUND,
    TOKEN_FETCH_ERROR,
    TOKEN_FETCH_RETURNED_EMPTY,
    TOKEN_NO_HASH_NO_SIG,
    TOKEN_VERIFY_GENERIC_ERROR,
    TOKEN_AUTH_HASH_NOT_VALID,
    SIGNATURE_VERIFY_ERROR,
    SIGNATURE_NO_VERIFIER,
    SIGNATURE_VERIFIED_INVALID,
}
export const AdvancedTokenAuthCode = ReturnCodeFamily(
    'AdvancedTokenAuthCode',
    AdvancedTokenAuthCodeEnum,
)

export class AdvancedTokenAuth {
    private tokenFetcher?: TokenFetcher
    private sigVerifier?: SignatureVerifier
    private messageSigner?: MessageSigner

    parseAdvancedToken(rawToken: string): Result<AdvancedToken> {
        if (!rawToken.startsWith('ADV')) {
            return null
        }
        try {
            const contentB64 = rawToken.slice(3)
            let [
                nameB64,
                nonce,
                hashB64,
                payloadB64,
                signatureB64,
                signedMessageB64,
            ] = atob(contentB64).split('.')
            if (!nameB64 || nameB64.length >= 256) {
                return AdvancedTokenAuthCode.error(
                    'ADV_TOKEN_PARSE_NAME_NOT_VALID',
                )
            }
            const name = Codec.base64ToUtf8(nameB64)
            if (hashB64 && hashB64.length >= 512) {
                return AdvancedTokenAuthCode.error(
                    'ADV_TOKEN_PARSE_HASH_NOT_VALID',
                )
            }
            const payload = Codec.base64ToUtf8(payloadB64)
            if (payload && payload.length >= 8000) {
                return AdvancedTokenAuthCode.error(
                    'ADV_TOKEN_PARSE_PAYLOAD_NOT_VALID',
                )
            }
            if (signatureB64 && !signedMessageB64) {
                signedMessageB64 = payloadB64
            }
            const advToken: AdvancedToken = {
                name,
                nonce,
                authHash: hashB64,
                payload,
                signature: signatureB64
                    ? Codec.base64ToBytes(signatureB64)
                    : null,
                signedMessage: signedMessageB64
                    ? Codec.base64ToBytes(signedMessageB64)
                    : null,
            }
            return ok(advToken)
        } catch (e) {
            return AdvancedTokenAuthCode.error(
                'ADV_TOKEN_PARSE_GENERIC_ERROR',
                e,
            )
        }
    }

    async createAdvancedToken(
        name: string,
        token?: string,
        payload?: string,
        signedMessage?: true | string | Uint8Array,
        signature?: Uint8Array,
        options?: AdvancedTokenCreateOption,
    ): Promise<Result<string>> {
        try {
            if (!payload) {
                return AdvancedTokenAuthCode.error('TOKEN_CREATE_NO_PAYLOAD')
            }
            const nameB64 = Codec.utf8ToBase64(name)
            const nonce = token ? randBase64Id(9) : ''
            const proofSha = token
                ? utilSha512(`${nonce} | ${payload} | ${token}`).slice(0, 32)
                : null
            const hashB64 = token
                ? btoa(String.fromCharCode.apply(null, proofSha))
                : ''
            const payloadB64 = Codec.utf8ToBase64(payload)
            let signedMessageB64 = ''
            let signatureB64 = ''
            if (signedMessage) {
                signedMessageB64 =
                    signedMessage === true
                        ? payloadB64
                        : typeof signedMessage === 'string'
                          ? Codec.utf8ToBase64(signedMessage)
                          : Codec.bytesToBase64(signedMessage)
                if (signature) {
                    signatureB64 = Codec.bytesToBase64(signature)
                } else if (this.messageSigner) {
                    const sigResult = await this.messageSigner(
                        Codec.base64ToBytes(signedMessageB64),
                    )
                    if (!sigResult.ok) {
                        return passthru(sigResult)
                    }
                    signatureB64 = Codec.bytesToBase64(sigResult.data)
                } else {
                    return AdvancedTokenAuthCode.error(
                        'TOKEN_CREATE_NO_MESSAGE_SIGNER',
                    )
                }
            }
            const contentB64 = btoa(
                `${nameB64}.${nonce}.${hashB64}.${payloadB64}.${signatureB64}.${signedMessageB64}`,
            )
            if (!options?.lengthUnlimited && contentB64.length > 8000) {
                return AdvancedTokenAuthCode.error(
                    'TOKEN_CREATE_LENGTH_TOO_LONG',
                    `token length ${contentB64.length} > 8000 (lengthUnlimited false)`,
                )
            }
            return ok(`ADV${contentB64}`)
        } catch (e) {
            return AdvancedTokenAuthCode.error('TOKEN_CREATE_GENERIC_ERROR', e)
        }
    }

    async verify(rawToken: string): Promise<Result<AdvancedTokenDetails>> {
        try {
            if (!rawToken) {
                return AdvancedTokenAuthCode.error('TOKEN_IS_EMPTY')
            }
            const advTokenRes = this.parseAdvancedToken(rawToken)
            if (!advTokenRes.ok) {
                return passthru(advTokenRes)
            }
            const advToken = advTokenRes.data
            if (!this.tokenFetcher) {
                return AdvancedTokenAuthCode.error('TOKEN_FETCHER_NOT_FOUND')
            }
            let tokenDetails: AdvancedTokenDetails
            try {
                const tokenFetchRes = await this.tokenFetcher(advToken.name)
                if (tokenFetchRes.bad) {
                    return passthru(tokenFetchRes)
                }
                tokenDetails = tokenFetchRes.data
                if (!tokenDetails) {
                    return AdvancedTokenAuthCode.error(
                        'TOKEN_FETCH_RETURNED_EMPTY',
                    )
                }
            } catch (e) {
                return AdvancedTokenAuthCode.error('TOKEN_FETCH_ERROR', e)
            }
            if (!tokenDetails.token && !advToken.signature) {
                return AdvancedTokenAuthCode.error('TOKEN_NO_HASH_NO_SIG')
            }
            if (tokenDetails.token) {
                const proofSha = utilSha512(
                    `${advToken.nonce} | ${advToken.payload} | ${tokenDetails.token}`,
                ).slice(0, 32)
                const proofShaStr = btoa(
                    String.fromCharCode.apply(null, proofSha),
                )
                if (advToken.authHash !== proofShaStr) {
                    return AdvancedTokenAuthCode.error(
                        'TOKEN_AUTH_HASH_NOT_VALID',
                    )
                }
            }
            if (tokenDetails.signingScheme && advToken.signature) {
                if (!this.sigVerifier) {
                    return AdvancedTokenAuthCode.error('SIGNATURE_NO_VERIFIER')
                }
                try {
                    const verifyResult = await this.sigVerifier(
                        tokenDetails.signingScheme,
                        advToken.signature,
                        advToken.signedMessage,
                    )
                    if (verifyResult.bad) {
                        return passthru(verifyResult)
                    }
                    if (verifyResult.data !== true) {
                        return AdvancedTokenAuthCode.error(
                            'SIGNATURE_VERIFIED_INVALID',
                        )
                    }
                } catch (e) {
                    return AdvancedTokenAuthCode.error(
                        'SIGNATURE_VERIFY_ERROR',
                        e,
                    )
                }
            }
            return ok(tokenDetails)
        } catch (e) {
            return AdvancedTokenAuthCode.error('TOKEN_VERIFY_GENERIC_ERROR', e)
        }
    }

    setTokenFetcher(fetcher: TokenFetcher) {
        this.tokenFetcher = fetcher
    }

    setSignatureVerifier(verifier: SignatureVerifier) {
        this.sigVerifier = verifier
    }

    setMessageSigner(messageSigner: MessageSigner) {
        this.messageSigner = messageSigner
    }
}
