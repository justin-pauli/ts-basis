import { HttpOp } from './http.shim.op'
import { HttpBaseLib, ReqProcessor } from './http.shim.types'
import { expressParseBody, expressParseQuery } from './plugin/express'
import { HttpShimCode } from './http.shim.codes'
import { SecureHandshake } from '../../secure-channel/secure-channel'
import { promise } from '../../../src'

export class PreHandler {
    byType: { [preType: string]: (op: HttpOp) => Promise<boolean> } = {}
    constructor() {
        this.byType = {
            [ReqProcessor.DECRYPT]: this.optionalDecrypt,
            [ReqProcessor.AUTH]: this.auth,
            [ReqProcessor.BASIC]: this.basic,
        }
    }
    async auth(op: HttpOp) {
        return promise<boolean>(async resolve => {
            const srvConfig = op.server.config
            if (srvConfig.security.noauth) {
                return resolve(true)
            }
            switch (srvConfig.type) {
                case HttpBaseLib.EXPRESS:
                    expressParseQuery(op)
                    const authFromQueryParamName =
                        op.api.headerOptions?.authFromQueryParamName ?? ''
                    let authData: string = authFromQueryParamName
                        ? op.params[authFromQueryParamName]
                        : op.oriReq.headers.authorization
                    if (!authData) {
                        authData = op.oriReq.headers.authorization
                    }
                    const apiRoleBook = op.server.apiAccess[op.api.handlerName]
                    if (apiRoleBook?.['allow-all']) {
                        return resolve(true)
                    }
                    if (!op.fromInternal && apiRoleBook?.['deny-all']) {
                        op.raise(
                            HttpShimCode.error(
                                'AUTH_HEADER_SIGNED_BUT_API_DENIES_ALL',
                                `API '${op.api.method} ${op.api.fullpath}' is set to deny-all`,
                            ),
                            401,
                        )
                    }
                    if (authData) {
                        // bearer token scheme
                        if (authData.startsWith('Bearer ')) {
                            const headerText = authData.split('Bearer ')[1]
                            op.auth.authorization = headerText
                            if (headerText.startsWith('SIGNED.')) {
                                const [
                                    signedType,
                                    scheme,
                                    payloadBase64,
                                    sigBase64,
                                    publicKey,
                                ] = headerText.split('.')
                                if (scheme === 'ECC_4Q') {
                                    let found = false
                                    for (const authServerKey of Object.keys(
                                        op.server.authServers,
                                    )) {
                                        if (
                                            op.server.authServers[authServerKey]
                                                .publicKey === publicKey
                                        ) {
                                            found = true
                                            break
                                        }
                                    }
                                    if (!found) {
                                        op.raise(
                                            HttpShimCode.error(
                                                'AUTH_HEADER_SIGNED_BUT_PUBLIC_KEY_NOT_FOUND',
                                            ),
                                            401,
                                        )
                                        return resolve(false)
                                    }
                                    const verifyResult =
                                        SecureHandshake.verifyStamp(
                                            {
                                                payload: payloadBase64,
                                                sig: sigBase64,
                                            },
                                            publicKey,
                                        )
                                    if (verifyResult.bad) {
                                        op.raise(verifyResult)
                                        return resolve(false)
                                    }
                                    try {
                                        const roleData = JSON.parse(
                                            Buffer.from(
                                                payloadBase64,
                                                'base64',
                                            ).toString('utf8'),
                                        )
                                        op.user = {
                                            username: roleData.name,
                                            publicKeys: roleData.publicKey,
                                            roles: roleData.server[
                                                op.server.config.name
                                            ],
                                            rolesApplicable: null,
                                        }
                                        let targetRoleKey: string[]
                                        if (
                                            apiRoleBook &&
                                            !apiRoleBook['allow-all']
                                        ) {
                                            targetRoleKey =
                                                Object.keys(apiRoleBook)
                                            const rolesApplicable: string[] = []
                                            for (const role of op.user.roles) {
                                                if (apiRoleBook[role]) {
                                                    rolesApplicable.push(role)
                                                }
                                            }
                                            op.user.rolesApplicable =
                                                rolesApplicable
                                            if (
                                                !op.user.rolesApplicable?.length
                                            ) {
                                                op.raise(
                                                    HttpShimCode.error(
                                                        'AUTH_HEADER_SIGNED_ROLE_UNAUTHORZIED_FOR_API',
                                                        `API '${op.api.method} ${op.api.fullpath}' as user '${op.user.username}' with roles [${op.user.roles.join(', ')}] ` +
                                                            `has no authorizable match for the API requiring [${targetRoleKey.join(', ')}]`,
                                                    ),
                                                    401,
                                                )
                                                return resolve(false)
                                            }
                                        }
                                    } catch (e) {
                                        op.raise(
                                            HttpShimCode.error(
                                                'AUTH_HEADER_SIGNED_NO_ROLES_MAP',
                                            ),
                                            401,
                                        )
                                        return resolve(false)
                                    }
                                    return resolve(true)
                                }
                            } else if (headerText.startsWith('SYMNT_HASH.')) {
                            }
                            const tokenConfig = srvConfig.security?.token
                            if (
                                tokenConfig?.custom &&
                                tokenConfig.customHandler
                            ) {
                                try {
                                    const handlerResult =
                                        await tokenConfig.customHandler(
                                            op,
                                            headerText,
                                        )
                                    if (!handlerResult.ok) {
                                        op.raise(handlerResult, 401)
                                        return resolve(false)
                                    }
                                    return resolve(true)
                                } catch (e) {
                                    op.raise(
                                        HttpShimCode.error(
                                            'AUTH_HEADER_CUSTOM_HANDLER_ERROR',
                                        ),
                                        401,
                                    )
                                    return resolve(false)
                                }
                            } else if (
                                tokenConfig?.value &&
                                tokenConfig.value === headerText
                            ) {
                                const roles =
                                    typeof srvConfig.security.token.role ===
                                    'string'
                                        ? [srvConfig.security.token.role]
                                        : Array.isArray(
                                                srvConfig.security.token.role,
                                            )
                                          ? srvConfig.security.token.role
                                          : []
                                op.user = {
                                    username: '',
                                    publicKeys: [],
                                    roles: [],
                                    rolesApplicable: [],
                                }
                                op.user.roles = JSON.parse(
                                    JSON.stringify(roles),
                                )
                                let targetRoleKey: string[]
                                if (apiRoleBook && !apiRoleBook['allow-all']) {
                                    targetRoleKey = Object.keys(apiRoleBook)
                                    const rolesApplicable: string[] = []
                                    for (const role of op.user.roles) {
                                        if (apiRoleBook[role]) {
                                            rolesApplicable.push(role)
                                        }
                                    }
                                    op.user.rolesApplicable = rolesApplicable
                                    if (!op.user.rolesApplicable?.length) {
                                        op.raise(
                                            HttpShimCode.error(
                                                'AUTH_HEADER_TOKEN_ROLE_UNAUTHORZIED_FOR_API',
                                                `API '${op.api.method} ${op.api.fullpath}' with roles [${op.user.roles.join(', ')}] ` +
                                                    `has no authorizable match for the API requiring [${targetRoleKey.join(', ')}]`,
                                            ),
                                            401,
                                        )
                                        return resolve(false)
                                    }
                                }
                                return resolve(true)
                            }
                        }
                        op.raise(
                            HttpShimCode.error('AUTH_HEADER_NOT_VALID'),
                            401,
                        )
                        return resolve(false)
                    } else {
                        op.raise(
                            HttpShimCode.error('AUTH_HEADER_NOT_FOUND'),
                            401,
                        )
                        return resolve(false)
                    }
                    break
            }
            console.error('Preprocessor AUTH deadend')
            return resolve(false)
        })
    }
    async basic(op: HttpOp) {
        return promise<boolean>(async resolve => {
            switch (op.server.config.type) {
                case HttpBaseLib.EXPRESS:
                    if (!op.api.headerOptions?.noContentType) {
                        op.oriRes.header('Content-Type', 'application/json')
                    }
                    const result = await expressParseBody(op)
                    return resolve(result)
                    break
            }
            console.error('Preprocessor BASIC deadend')
            return resolve(false)
        })
    }
    async optionalDecrypt(op: HttpOp) {
        return new Promise<boolean>(resolve => {})
    }
}

export class PostHandler {
    byType: { [postType: string]: (op: HttpOp) => Promise<boolean> } = {}
    constructor() {
        this.byType = {
            [ReqProcessor.BASIC]: this.basic,
            [ReqProcessor.ENCRYPT]: this.optionalEncrypt,
        }
    }
    async basic(op: HttpOp) {
        return new Promise<boolean>(resolve => {
            switch (op.server.config.type) {
                case HttpBaseLib.EXPRESS:
                    resolve(true)
                    break
            }
        })
    }
    async optionalEncrypt(op: HttpOp) {
        return new Promise<boolean>(resolve => {
            switch (op.server.config.type) {
                case HttpBaseLib.EXPRESS:
                    resolve(true)
                    break
            }
        })
    }
}
