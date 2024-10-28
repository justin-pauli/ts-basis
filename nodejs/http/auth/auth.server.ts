/*
 * Copyright 2014-2021 Justin Pauli, all rights reserved.
 */
import {
    Tasks,
    httpRest,
    parseProperties,
    parsePropertyValue,
    toBe,
} from '../../../src/common/globals.ix'
import { as, required } from '../../../src/type-transform'
import { SecureHandshake } from '../../secure-channel/secure-channel'
import {
    HttpServerShim,
    HTTP,
    HttpBaseLib,
    HttpOp,
    ReqProcessor,
    HttpOpType,
} from '../http.shim'
import * as fs from 'fs'
import { pathNavigate } from '../../util/node-util'
import { APP, envVar } from '../../../src/common/env/env.profile'
import { SecureChannelTypes } from '../../../src/common/security/security.common'

// AUTH_SERVER_APP_PROFILE
// AUTH_SERVER_INDEX_KEY
// AUTH_SERVER_CONFIG_FILE
// AUTH_SERVER_DATA_RESOLUTION

const scopeName = `authsrv;pid=${process.pid}`

const appProfile = APP.PROFILE

const roles = {
    ADMIN: 99,
    NO_AUTH: 0,
}

export class AuthServer extends HttpServerShim<typeof roles> {
    appProfile: string = envVar('AUTH_SERVER_APP_PROFILE', 'test')
    dataResolution: 'local-file' | 'remote' = envVar(
        'AUTH_SERVER_DATA_RESOLUTION',
        'local-file',
    )
    publicKey: string

    localConfigData: any

    constructor() {
        const indexKey = envVar('AUTH_SERVER_INDEX_KEY', 'default')
        super({
            indexKey,
            name: `auth-server-${indexKey}`,
            env: appProfile,
            type: HttpBaseLib.EXPRESS,
            scopeName,
            security: {
                accessor: {
                    required: false,
                    baseToken: '<secret.authServers.default.token>',
                },
                secureChannel: {
                    enabled: true,
                    required: false,
                    encryption: SecureChannelTypes.ECC_4Q,
                    signingKey: '<secret.authServers.default.signingKey>',
                },
            },
            startOptions: {
                port: toBe`<config.authServers.default.port ?: number:17071>`,
            },
            skipAuthServerResolution: true,
        })
        this.apiVersion = 'v1'
        this.apiPath = this.configGlobal.api.basePath
        this.addDefaultProcessor(ReqProcessor.BASIC)
        if (this.dataResolution === 'local-file') {
            this.getLocalConfig()
            Tasks.addForeground(
                this,
                'local-config-file-refresh-check',
                () => {
                    try {
                        this.getLocalConfig()
                    } catch (e) {
                        console.error(e)
                    }
                },
                30000,
            )
        }
    }

    afterConfigResolution() {
        this.publicKey = SecureHandshake.getPublicKeyFrom(
            this.config.security.secureChannel.signingKey,
        )
    }

    getLocalConfig() {
        const configFile = envVar('AUTH_SERVER_CONFIG_FILE', 'auth.properties')
        try {
            this.localConfigData = parseProperties(
                fs.readFileSync(configFile, 'utf8'),
            )
        } catch (e) {
            console.error(
                `Unable to get local auth config from '${configFile}'`,
            )
        }
    }

    getUniverse_iface = {
        path: `/universe` as const,
        rootMount: true,
        description: ``,
        params: {},
        returns: {
            type: '{universe: string}',
            default: as<{ universe: string }>(),
        },
    }
    @HTTP.GET(`/universe`, { rootMount: true })
    async getUniverse(op: HttpOpType<typeof this.getUniverse_iface>) {
        return op.returnJson({ universe: this.appProfile })
    }

    getProfile_iface = {
        path: `/profile` as const,
        rootMount: true,
        description: ``,
        params: {},
        returns: {
            type: '{profile: string}',
            default: as<{ profile: string }>(),
        },
    }
    @HTTP.GET(`/profile`, { rootMount: true })
    async getProfile(op: HttpOpType<typeof this.getProfile_iface>) {
        return op.returnJson({ profile: this.appProfile })
    }

    getAuthentication_iface = {
        path: `/authenticate`,
        rootMount: true,
        description: ``,
        params: {
            type: { type: `string`, default: as<string>() },
            servers: { required, type: `string`, default: as<string>() },
            apiKey: { required, type: `string`, default: as<string>() },
        },
        returns: {
            type: '{refreshToken: string}',
            default: as<{ refreshToken: string }>(),
        },
    }
    @HTTP.METHODS(httpRest, `/authenticate`, { rootMount: true })
    async getAuthentication(
        op: HttpOpType<typeof this.getAuthentication_iface>,
    ) {
        if (this.dataResolution === 'local-file') {
            const path = ['secret', 'authServers', 'apiKey', op.params.apiKey]
            const servers = op.params.servers.split(',')
            let resolved: string = pathNavigate(
                path,
                this.localConfigData?.profiles?.[this.config.env],
            )
            if (resolved === null) {
                resolved = pathNavigate(path, this.localConfigData?.global)
            }
            if (resolved) {
                const infoAll = parsePropertyValue(resolved)
                const server = {}
                Object.keys(infoAll.server).forEach(serverName => {
                    if (servers.indexOf(serverName) >= 0) {
                        server[serverName] = infoAll.server[serverName]
                    }
                })
                const info = {
                    username: infoAll.username,
                    publicKey: infoAll.publicKey,
                    baseRoles: infoAll.baseRoles,
                    server,
                }
                const rolesPayload = JSON.stringify(info)
                const stamp = await this.stamp(rolesPayload, 'utf8')
                const auth = `SIGNED.ECC_4Q.${stamp.payload}.${stamp.sig}.${this.publicKey}`
                op.returnJson({ refreshToken: auth })
            }
        }
    }
}
