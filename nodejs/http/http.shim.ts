/*
 * Copyright 2014-2021 Justin Pauli, all rights reserved.
 */

import {
    Class,
    completeConfig,
    HttpCode,
    HttpMethod,
    httpRest,
    isJsonString,
    Logger,
    ok,
    promise,
    Promise2,
    PromUtil,
    Result,
} from '../../src'
import { Entity } from '../../src/common/ix'
import { AsyncWorkerClient } from '../proc/async.worker.proc'
import {
    SecureChannel,
    SecureHandshake,
} from '../secure-channel/secure-channel'
import { DestorClient, getDestorClient } from './destor/destor.client'
import { CacheDef, CacheEntry } from './shim/http.shim.cache'
import { ServerConstDataGlobal } from './shim/http.shim.global.conf'
import { PostHandler, PreHandler } from './shim/http.shim.handlers'
import {
    HttpApiRoleAccess,
    HttpBaseLib,
    HttpParams,
    HttpPathResolution,
    HttpServerShimApi,
    HttpServerShimConfig,
    HttpServerShimType,
    HttpShimPublicInfo,
    ReqProcessor,
    ServerStartOptions,
} from './shim/http.shim.types'
import { ProcessExit } from '../proc/process.exit.handler'
import { SecretManager } from '../secret-resoluton/secret-resolver'
import { SecureChannelWorkerClient } from './http.shim.worker.security'

import defaultGlobalConfig from './http.shim.global.conf.json'
import defaultConfig from './http.shim.default.config.json'
import { proxyParameterFunctionToNull } from '../../src/common/util/convenience/dev.null.proxy'
import * as express from 'express'
import ExpressLib from 'express'
import { HTTP } from './shim/http.shim.decorators'
import { HttpOp } from './shim/http.shim.op'
import {
    AccessHeaderObject,
    SecureChannelPayload,
    SecureChannelPeer,
} from '../../src/common/security/security.common'
import { expressHandler } from './shim/plugin/express'
import * as url from 'url'

export class HttpServerShim<RoleRubric = any>
    extends Entity
    implements HttpServerShimType<RoleRubric>
{
    config: HttpServerShimConfig
    configGlobal: ServerConstDataGlobal
    configResolutionPromise: Promise<any>
    publicInfo: any = {}
    publicInfoString: string = ''
    baseApp: any
    authServers: {
        [url: string]: {
            type: 'jwt' | '4q_stamp'
            publicKey: string
            token?: string
        }
    } = {}
    apiPath: string = 'api'
    apiVersion: string = 'v1'
    apiRegistrations: HttpServerShimApi[]
    apiAccess: { [methodName: string]: HttpApiRoleAccess<RoleRubric> }
    apiMap: { [key: string]: HttpServerShimApi }
    apiPathList: string[] = []
    apiPathIface: {
        [mathodAndPath: string]: {
            method: string
            path: string
            handlerName: string
            description: string
            params: HttpParams
            returns: any
            acl: HttpApiRoleAccess<RoleRubric, HttpParams>
        }
    } = {}
    rolebook: RoleRubric | { [roleName: string]: any }
    logger: Logger
    destor: DestorClient
    destorPromise: Promise2<DestorClient>
    pathTree: { [key: string]: any } = {}
    preHandler: PreHandler
    postHandler: PostHandler
    defaultProcessors: ReqProcessor[] = []
    proxyRequest = {
        enabled: false,
        requestCheckers: [],
    } as {
        enabled: boolean
        requestCheckers?: ((params: {
            [paramName: string]: any
        }) => Promise2<{ allowed: boolean; message?: string }>)[]
    }
    secureChannels: { [channelId: string]: SecureChannel } = {}
    workerFleet: {
        [workerFleetClassName: string]: { workers: AsyncWorkerClient[] }
    } = {}
    cacheData: { [key: string]: CacheEntry } = {}
    extData: any
    state = {
        serverInit: true,
        activePort: 0,
        closed: false,
        started: false,
        apiRegistered: false,
        apiRegisterStack: null,
        closingPromise: null as Promise<any>,
    }
    baseLibData = {
        express: {
            server: null,
        },
    }

    constructor(
        config: HttpServerShimConfig,
        globalConf?: ServerConstDataGlobal,
        beforeSuper?: () => any,
    ) {
        if (beforeSuper) {
            beforeSuper()
        }
        super('http-shim')
        this.configGlobal = completeConfig(
            globalConf ? globalConf : {},
            defaultGlobalConfig,
        )
        this.config = this.normalizeServerConfig(config)
        this.preHandler = new PreHandler()
        this.postHandler = new PostHandler()
        this.configResolutionPromise = this.configResolution()
        if (this.config.waitForServerInit) {
            this.state.serverInit = false
        }
        this.setBaseLayer()
        if (!this.config.name) {
            this.config.name = 'unnamed-server'
        }
        if (!this.config.env) {
            this.config.env = 'test'
        }
        ProcessExit.addHandler(e => {
            this.close()
        })
    }

    async configResolution() {
        if (!this.config.skipConfigSecretResolution) {
            const destor = await this.getDestorClient()
            this.config = await SecretManager.resolve(this.config, destor)
            if (!this.config.skipAuthServerResolution) {
                this.authServers = (await SecretManager.resolve(
                    '<config.authServers>',
                    destor,
                )) as any as typeof this.authServers
            }
        }
        if (
            this.config.security.secureChannel.enabled &&
            this.config.security.secureChannel.signingKey
        ) {
            const channelKey = this.config.security.secureChannel.signingKey
            if (
                !this.config.security.secureChannel.publicKey &&
                channelKey &&
                !channelKey.startsWith('<')
            ) {
                this.config.security.secureChannel.publicKey =
                    SecureHandshake.getPublicKeyFrom(channelKey)
            }
            for (
                let i = 0;
                i < this.config.workers.secureChannelWorkers.initialCount;
                ++i
            ) {
                this.addWorker(SecureChannelWorkerClient, {
                    workerId: i,
                    scopeName: this.config.scopeName,
                    signingKey: channelKey,
                })
            }
        }
        this.configResolutionPromise = null
        this.afterConfigResolution()
    }

    registerApis() {
        if (this.state.apiRegistered) {
            throw new Error(
                `Cannot register apis twice; already registered from ${this.state.apiRegisterStack}`,
            )
        }
        this.state.apiRegistered = true
        this.state.apiRegisterStack = new Error().stack
        for (const api of this.apiRegistrations) {
            if (this instanceof api.class) {
                this.register(api)
            }
        }
    }

    normalizeServerConfig(config: HttpServerShimConfig) {
        if (!config.scopeName) {
            config.scopeName = `httpshim;pid=${process.pid}`
        }
        const newConfig = completeConfig<HttpServerShimConfig>(
            config,
            defaultConfig as any,
        )
        newConfig.debug.showErrorStack = true
        return newConfig
    }

    addDefaultProcessor(...processors: ReqProcessor[]) {
        if (this.state.apiRegistered) {
            throw new Error(
                `addDefaultProcessor must be called before api registration`,
            )
        }
        for (const proc of processors) {
            this.defaultProcessors.push(proc)
        }
    }

    cacheDefine<T = any>(init?: Partial<CacheDef<T>>) {
        if (this.cacheData[init.path]) {
            throw new Error(`Cache path '${init.path}' is already defined.`)
        }
        const def = new CacheDef<T>(init)
        this.cacheData[def.path] = new CacheEntry<T>({
            value: null,
            hits: 0,
            version: 0,
            def,
        })
        return def
    }

    addWorker<T extends AsyncWorkerClient>(
        workerClass: Class<T>,
        workerData?: { [key: string]: any },
    ) {
        if (!workerData) {
            workerData = {}
        }
        if (!this.workerFleet[workerClass.name]) {
            this.workerFleet[workerClass.name] = { workers: [] }
        }
        const workersReg = this.workerFleet[workerClass.name]
        const worker = new workerClass(workerData)
        workersReg.workers.push(worker)
        return worker
    }

    pickWorker<T extends AsyncWorkerClient>(workerClass: Class<T>): T {
        if (!this.workerFleet[workerClass.name]) {
            return proxyParameterFunctionToNull
        }
        const workers = this.workerFleet[workerClass.name].workers
        if (workers.length === 0) {
            return proxyParameterFunctionToNull
        }
        return this.workerFleet[workerClass.name].workers[0] as T
    }

    setBaseLayer() {
        switch (this.config.type) {
            case HttpBaseLib.EXPRESS:
                this.baseApp = (express.default as any)()
                const secOptions = this.configGlobal.http.securityHeaders
                if (secOptions.profile === 'allow-all') {
                    this.baseApp.use((req, res, next) => {
                        if (secOptions.allowRequestOrigin) {
                            res.header(
                                'Access-Control-Allow-Origin',
                                secOptions.allowRequestOrigin,
                            )
                        }
                        if (secOptions.allowRequestHeaders) {
                            res.header(
                                'Access-Control-Allow-Headers',
                                secOptions.allowRequestOrigin,
                            )
                        }
                        if (req.method === 'OPTIONS') {
                            res.header(
                                'Access-Control-Allow-Methods',
                                'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                            )
                            return res.end()
                        }
                        next()
                    })
                }
                break
        }
    }

    setFinalLayer() {
        switch (this.config.type) {
            case HttpBaseLib.EXPRESS:
                // TODO
                break
        }
    }

    setServerInitStatus(v: boolean) {
        this.state.serverInit = v
    }

    async getDestorClient() {
        if (this.destor) {
            return this.destor
        }
        if (this.destorPromise) {
            return await this.destorPromise
        }
        this.destorPromise = getDestorClient()
        this.destor = await this.destorPromise
    }

    @HTTP.GET(HTTP.SHIM.ROOT_API_ROLES_TEST, { rootMount: true, builtIn: true })
    @HTTP.ACCESS({ ADMIN: true, NO_AUTH: true })
    async getRoles(op: HttpOp<{}>) {
        return op.res.returnJsonPreserialized('')
    }

    @HTTP.GET(HTTP.SHIM.ROOT_API_PUBLIC_INFO, {
        rootMount: true,
        builtIn: true,
    })
    async getServerPublicInfo(op: HttpOp<{}>) {
        return op.res.returnJsonPreserialized(this.publicInfoString)
    }

    @HTTP.GET(HTTP.SHIM.ROOT_API_NEW_CHANNEL, {
        rootMount: true,
        builtIn: true,
    })
    async newSecureChannel(op: HttpOp) {
        const accessInfoResult = this.checkAccessor(op, true)
        if (accessInfoResult.bad) {
            return op.raise(accessInfoResult, HTTP.STATUS.BAD_REQUEST)
        }
        const accessInfo = accessInfoResult.data
        const peerInfo: SecureChannelPeer = {
            ecdhPublicKey: Buffer.from(accessInfo.channelPublicKey, 'base64'),
            iden: null,
            data: null,
        }
        const channel = await this.pickWorker(
            SecureChannelWorkerClient,
        ).newChannel(peerInfo)
        channel.signing = {
            type: '4Q',
            public: this.config.security.secureChannel.publicKey,
            private: this.config.security.secureChannel.signingKey,
        }
        this.secureChannels[channel.peerInfo.ecdhPublicKey.toString('base64')] =
            channel
        const secureChannelResponseResult = channel.getSecureChannelResponse()
        if (secureChannelResponseResult.bad) {
            return op.raise(
                secureChannelResponseResult,
                HTTP.STATUS.UNAUTHORIZED,
            )
        }
        return op.res.returnJson(secureChannelResponseResult.data)
    }

    @HTTP.METHODS(httpRest, HTTP.SHIM.ROOT_API_SECURE_API, {
        rootMount: true,
        builtIn: true,
    })
    async encryptedOperation(op: HttpOp<{}>, skipRunning = false) {
        const api = op.req.decryptedApiTarget
        if (!skipRunning) {
            await this[api.handlerName](op)
        }
        // await api.handler(op);
    }

    @HTTP.GET(HTTP.SHIM.ROOT_API_PROXY_REQUEST, {
        rootMount: true,
        builtIn: true,
    })
    async proxyRequestOperation(op: HttpOp) {
        if (this.proxyRequest.enabled) {
            return op.res.returnNotOk(500, `Proxy request not enabled`)
        }
        if (this.proxyRequest.requestCheckers?.length) {
            for (const checker of this.proxyRequest.requestCheckers) {
                const { allowed, message } = await checker(op.req.params)
                if (!allowed) {
                    return op.res.returnNotOk(
                        500,
                        `Proxy request not allowed: ${message}`,
                    )
                }
            }
        }
        const paramsCopy = JSON.parse(JSON.stringify(op.req.params))
        let url = paramsCopy.__url
        const method: HttpMethod = paramsCopy.__method
            ? paramsCopy.__method
            : HttpMethod.GET
        const timeout = paramsCopy.__timeout ? paramsCopy.__timeout : 7000
        const headers = paramsCopy.__headers ? paramsCopy.__headers : ''
        if (paramsCopy.__url) {
            delete paramsCopy.__url
        }
        if (paramsCopy.__method) {
            delete paramsCopy.__method
        }
        if (paramsCopy.__headers) {
            delete paramsCopy.__headers
        }
        if (paramsCopy.__timeout) {
            delete paramsCopy.__timeout
        }
        if (paramsCopy.__enc) {
            delete paramsCopy.__enc
        }
        const newHeaders: { [headerName: string]: string } = {}
        for (const headerName of headers.split(',')) {
            const headerValue = op.req.getHeader(headerName)
            if (headerValue) {
                newHeaders[headerName] = headerValue
            }
        }
        const reqOpts = {
            headers: newHeaders,
            body: '',
            signal: timeout ?? AbortSignal.timeout(timeout),
        }
        if (method === 'GET') {
            const queryString = new URLSearchParams(paramsCopy).toString()
            url = `${url}?${queryString}`
        } else {
            newHeaders['Content-Type'] = 'application/json'
            reqOpts.body = JSON.stringify(paramsCopy)
        }
        op.waitFor(resolve => {
            fetch(url, { method, ...reqOpts })
                .then(async res => {
                    res.json().then(data => {
                        op.res.returnJson(data)
                        resolve()
                    })
                })
                .catch(e => {
                    const res = e.response
                    if (res) {
                        op.res.returnNotOk(
                            res.status,
                            `Proxy request failed: ${res.data}`,
                        )
                    } else {
                        op.res.returnNotOk(
                            500,
                            `Proxy request failed: ${e.message}`,
                        )
                    }
                    resolve()
                })
        })
    }

    addAccessRule(
        memberMethodName: keyof typeof this,
        access: HttpApiRoleAccess<RoleRubric>,
    ) {
        if (!this.apiAccess) {
            this.apiAccess = {}
        }
        const memberMethodName2 = memberMethodName as string
        if (!this[memberMethodName2]) {
            throw new Error(
                `Cannot defined roles for non-existing class method '${memberMethodName2}'`,
            )
        }
        this.apiAccess[memberMethodName2 as any] = access
    }

    addRegistration(api: HttpServerShimApi) {
        if (!this.apiRegistrations) {
            this.apiRegistrations = []
        }
        this.apiRegistrations.push(api)
    }

    register(api: HttpServerShimApi) {
        const apiVersion = api.apiVersion ? api.apiVersion : this.apiVersion
        const apiPath = api.apiPath ? api.apiPath : this.apiPath
        const finalMountPath = api.rootMount ? '' : `/${apiPath}/${apiVersion}`
        const fullpath = `${finalMountPath}/${api.path}`.replace(/\/\//g, '/')
        api.fullpath = fullpath
        this.pathResolve(fullpath, api)
        const apiKey = `${api.method} ${api.fullpath}`
        this.apiPathList.push(apiKey)
        const iface = this[api.handlerName + '_iface']
        if (iface) {
            iface.consumed = 1
            this.apiPathIface[apiKey] = {
                method: api.method,
                path: api.path,
                handlerName: api.handlerName,
                description: iface.description ? iface.description : '',
                params: Object.keys(iface.params).map(paramName => {
                    const paramInfo = iface.params[paramName]
                    return {
                        required: paramInfo.required ? true : false,
                        type: paramInfo.type,
                    }
                }),
                returns: iface.returns.type,
                acl: null,
            }
            setImmediate(() => {
                this.apiPathIface[apiKey].acl = this.apiAccess[api.handlerName]
                    ? this.apiAccess[api.handlerName]
                    : null
            })
        }
        if (!api.pre) {
            api.pre = []
        }
        if (!api.preDefaultProcesserAdded) {
            api.pre = [...this.defaultProcessors, ...api.pre]
            api.pre = api.pre.filter((a, i) => api.pre.indexOf(a) === i)
            api.preDefaultProcesserAdded = true
        }
        if (!api.preExclude) {
            api.preExclude = []
        }
        if (!api.preProcesserExcludesAdded) {
            api.preExclude = [...api.preExclude]
            api.preExclude = api.preExclude.filter(
                (a, i) => api.preExclude.indexOf(a) === i,
            )
            api.preProcesserExcludesAdded = true
        }
        switch (this.config.type) {
            case HttpBaseLib.EXPRESS:
                switch (api.method) {
                    case HttpMethod.GET:
                        return this.baseApp.get(
                            fullpath,
                            expressHandler(this, api),
                        )
                    case HttpMethod.POST:
                        return this.baseApp.post(
                            fullpath,
                            expressHandler(this, api),
                        )
                    case HttpMethod.PUT:
                        return this.baseApp.put(
                            fullpath,
                            expressHandler(this, api),
                        )
                    case HttpMethod.PATCH:
                        return this.baseApp.patch(
                            fullpath,
                            expressHandler(this, api),
                        )
                    case HttpMethod.DELETE:
                        return this.baseApp.delete(
                            fullpath,
                            expressHandler(this, api),
                        )
                }
                break
        }
        console.error(`unmatched api`, api)
    }

    beforeStart() {}
    afterStart() {}
    afterConfigResolution() {}
    beforeStop() {}
    afterStop() {}

    addPublicInfo(info: { [infoKey: string]: any }) {
        Object.assign(this.publicInfo, info)
    }

    start(options?: ServerStartOptions) {
        return promise(async (resolve, reject) => {
            if (this.state.started) {
                return resolve()
            }
            this.state.started = true
            if (this.configResolutionPromise) {
                await this.configResolutionPromise
            }
            if (!options) {
                options = this.config.startOptions
            }
            if (!options) {
                return reject(
                    new Error(`Cannot start server without start options.`),
                )
            }
            this.addPublicInfo({
                tokenRequired: this.config.security.token.required,
                accessorRequired: this.config.security.accessor.required,
                secureChannelScheme:
                    this.config.security.secureChannel.encryption,
                secureChannelPublicKey:
                    this.config.security.secureChannel.publicKey,
                secureChannelStrict: this.config.security.secureChannel.strict,
                secureChannelRequired:
                    this.config.security.secureChannel.required,
                apiPathList: this.apiPathList,
                apiInterface: this.apiPathIface,
            } as HttpShimPublicInfo<RoleRubric>)
            this.apiRegistrations = this.apiRegistrations.filter(
                api => this instanceof api.class,
            )
            const newAccess = {}
            Object.keys(this.apiAccess).forEach(handlerName => {
                if (this instanceof this.apiAccess[handlerName]['class']) {
                    newAccess[handlerName] = this.apiAccess[handlerName]
                }
            })
            this.apiAccess = newAccess
            this.registerApis()
            this.publicInfoString = JSON.stringify(this.publicInfo, null, 4)
            switch (this.config.type) {
                case HttpBaseLib.EXPRESS:
                    try {
                        this.beforeStart()
                    } catch (e) {
                        console.error(e)
                    }
                    try {
                        const app = this.baseApp as ExpressLib.Express
                        this.baseLibData.express.server = app.listen(
                            options.port,
                            () => {
                                this.state.activePort = options.port
                                resolve()
                                try {
                                    this.afterStart()
                                } catch (e) {
                                    console.error(e)
                                }
                            },
                        )
                    } catch (e) {
                        return reject(e)
                    }
                    break
            }
        })
    }

    close() {
        if (this.state.closingPromise) {
            return this.state.closingPromise
        }
        this.state.closed = true
        switch (this.config.type) {
            case HttpBaseLib.EXPRESS:
                this.state.closingPromise = promise(async resolve => {
                    const proms: Promise<any>[] = []
                    try {
                        this.beforeStop()
                    } catch (e) {
                        console.error(e)
                    }
                    try {
                        this.baseLibData?.express?.server?.close()
                    } catch (e) {
                        console.error(e)
                    }
                    try {
                        proms.push(this.destroyAllWorkers())
                    } catch (e) {
                        console.error(e)
                    }
                    try {
                        this.afterStop()
                    } catch (e) {
                        console.error(e)
                    }
                    await PromUtil.allSettled(proms)
                    resolve()
                })
                break
        }
        return this.state.closingPromise
    }

    async stamp(payload?: string | Buffer, encoding: BufferEncoding = 'ascii') {
        if (!payload) {
            payload = SecureHandshake.timeAuth()
        }
        let payloadB64: string
        if (typeof payload === 'string') {
            payloadB64 = Buffer.from(payload, encoding).toString('base64')
        } else {
            payloadB64 = payload.toString('base64')
        }
        const sig = await this.pickWorker(
            SecureChannelWorkerClient,
        ).signMessage(payloadB64)
        return { payload: payloadB64, sig }
    }

    prepareEncryptedOperation(op: HttpOp): Result<HttpServerShimApi> {
        if (op.req.decryptedApiTarget) {
            return ok(op.req.decryptedApiTarget)
        }
        const decryptResult = this.getDecryptedPayload(op)
        if (decryptResult.bad) {
            return op.raise(decryptResult, HTTP.STATUS.UNAUTHORIZED)
        }
        if (!op.req.decryptedPayloadObject) {
            return op.raise(
                HttpCode.BAD_REQUEST,
                `ENCRYPTED_OP_NON_JSON_PAYLOAD`,
                `Supplied secure payload is not JSON format`,
            )
        }
        const args = op.req.decryptedPayloadObject as {
            id: string
            path: string
            body: any
            headers?: { [name: string]: string }
        }
        const resolved = this.pathResolve(args.path)
        if (!resolved) {
            return op.raise(
                HttpCode.NOT_FOUND,
                `ENCRYPTED_OP_PATH_NOT_FOUND`,
                `Encrypted access to unknown path: '${args.path}'`,
            )
        }
        const api = resolved.methods[op.method]
        if (!api) {
            return op.raise(
                HttpCode.NOT_FOUND,
                `ENCRYPTED_OP_METHOD_NOT_FOUND`,
                `Method ${op.method} not found for '${api.fullpath}'`,
            )
        }
        if (args.headers) {
            Object.assign(op.req.headers, args)
        }
        op.params = op.req.params
        const pathQueryParams = url.parse(args.path, true).query
        if (Object.keys(resolved.params).length > 0) {
            Object.assign(op.req.params, resolved.params)
        }
        if (Object.keys(pathQueryParams).length > 0) {
            Object.assign(op.req.params, pathQueryParams)
        }
        if (args.body) {
            try {
                const data = JSON.parse(args.body)
                op.req.data = data
                if (data && typeof data === 'object' && !Array.isArray(data)) {
                    Object.assign(op.req.params, data)
                }
            } catch (e) {
                // non JSON body, ignore
            }
        }
        op.req.decryptedApiTarget = api
        return ok(api)
    }

    checkAccessor<Params = HttpParams, Returns = any>(
        op: HttpOp<Params, Returns>,
        forceVerify = false,
    ): Result<
        Partial<AccessHeaderObject> &
            Partial<{ accessor: string; t: number; channelPublicKey?: string }>
    > {
        const authorizationHeader = op.req.getHeader('Accessor')
        const accessorConf = this.config.security.accessor
        if (accessorConf.required || forceVerify) {
            if (!authorizationHeader) {
                return op.raise(
                    HttpCode.UNAUTHORIZED,
                    `ACCESSOR_HEADER_NOT_FOUND`,
                    `Accessor header does not exist`,
                )
            }
        } else {
            return ok({ accessor: null, t: 0, channelPublicKey: '' })
        }
        const authInfo = SecureHandshake.parseAuthHeader(authorizationHeader)
        const accessorExpression = authInfo.accessorExpression
        const timeWindow = this.config.security.accessor.timeWindow
        if (!accessorConf.baseTokenBuffer) {
            accessorConf.baseTokenBuffer = Buffer.from(
                accessorConf.baseToken,
                'ascii',
            )
        }
        const accessDataResult = SecureHandshake.verifyAccessor(
            accessorExpression,
            accessorConf.baseTokenBuffer,
            timeWindow,
        )
        if (accessDataResult.bad) {
            return op.raise(accessDataResult, HttpCode.UNAUTHORIZED)
        }
        return ok({
            ...accessDataResult.data,
            channelPublicKey: authInfo.peerEcdhPublicKey,
        })
    }

    getSecureChannel<Params = HttpParams, Returns = any>(
        op: HttpOp<Params, Returns>,
    ) {
        const accessInfoResult = this.checkAccessor(op, true)
        if (accessInfoResult.bad) {
            return op.raise(accessInfoResult, HTTP.STATUS.BAD_REQUEST)
        }
        const channelId = accessInfoResult.data.channelPublicKey
        const channel = this.secureChannels[channelId]
        if (!channel) {
            return op.raise(
                HttpCode.UNAUTHORIZED,
                `SECURE_CHANNEL_NOT_FOUND`,
                `secure channel not found: ${channelId}`,
            )
        }
        op.secureChannel = channel
        return ok(channel)
    }

    getDecryptedPayload<Params = HttpParams, Returns = any>(
        op: HttpOp<Params, Returns>,
    ) {
        if (op.req.decryptedPayload) {
            return ok(op.req.decryptedPayload)
        }
        const channelResult = this.getSecureChannel(op)
        if (channelResult.bad) {
            return op.raise(channelResult, HTTP.STATUS.UNAUTHORIZED)
        }
        const channel = channelResult.data
        const payload: SecureChannelPayload = channel.parseWrappedPayloadBase64(
            op.req.encryptedPayload,
        )
        if (!payload || !payload.__scp) {
            return op.raise(
                HttpCode.BAD_REQUEST,
                'ENCRYPTED_OP_NO_SECURE_PAYLOAD',
                'Secure payload not found',
            )
        }
        op.req.decryptedPayload =
            channel.decryptSecureChannelPayloadIntoString(payload)
        if (isJsonString(op.req.decryptedPayload)) {
            op.req.decryptedPayloadObject = JSON.parse(op.req.decryptedPayload)
        }
        return ok(op.req.decryptedPayload)
    }

    handlePre<Params = HttpParams, Returns = any>(op: HttpOp<Params, Returns>) {
        return promise(async resolve => {
            let allPassed = true
            const pre = op.api.pre ?? []
            const preExclude = op.api.preExclude ?? []
            if (pre.length > 0 && preExclude.indexOf('all') === -1) {
                for (const preType of pre) {
                    const preFunc = this.preHandler.byType[preType]
                    if (!preFunc || preExclude.indexOf('preType') >= 0) {
                        continue
                    }
                    let passed = false
                    try {
                        passed = await preFunc.apply(this.preHandler, [op])
                    } catch (e) {
                        console.error(e)
                    }
                    if (!passed) {
                        allPassed = false
                        break
                    }
                }
            }
            resolve(allPassed)
        })
    }

    handlePost<Params = HttpParams, Returns = any>(
        op: HttpOp<Params, Returns>,
    ) {
        return promise(async resolve => {
            let allPassed = true
            if (op.api.post) {
                for (const postType of op.api.post) {
                    const postFunc = this.postHandler.byType[postType]
                    if (!postFunc) {
                        continue
                    }
                    let passed = false
                    try {
                        passed = await postFunc.apply(this.postHandler, [op])
                    } catch (e) {
                        console.error(e)
                    }
                    if (!passed) {
                        allPassed = false
                        break
                    }
                }
            }
            resolve(allPassed)
        })
    }

    getApiEnv(): any {
        return this
    }

    private pathResolve(
        path: string,
        newApi: HttpServerShimApi = null,
    ): HttpPathResolution {
        const paths = path.split('/')
        if (paths[0] === '') {
            paths.shift()
        }
        const paramCollector = {}
        let node = this.pathTree
        for (const pathSlot of paths) {
            const slot = decodeURIComponent(
                pathSlot.split('?')[0].split('#')[0],
            )
            if (slot === '__apidef__') {
                return null
            }
            const isParam = slot.startsWith(':')
            if (node[slot]) {
                node = node[slot]
                continue
            }
            const paramDef = node['?param-name?']
            if (paramDef) {
                if (newApi && isParam && paramDef.slot !== slot) {
                    throw new Error(
                        `Cannot register a parameter slot ${slot}, ` +
                            `parameter ${paramDef.slot} has been registered by ${paramDef.registeredPath}`,
                    )
                }
                paramCollector[paramDef.name] = slot
                node = paramDef.nextNode
                continue
            }
            if (newApi) {
                const nextNode = {}
                if (isParam) {
                    node['?param-name?'] = {
                        nextNode,
                        slot,
                        name: slot.substr(1),
                        registeredPath: path,
                    }
                }
                node[slot] = nextNode
                node = node[slot]
            } else {
                return null
            }
        }
        if (!node) {
            return null
        }
        if (newApi) {
            if (node.__apidef__ && node.__apidef__.methods[newApi.method]) {
                throw new Error(
                    `Cannot register api at ${newApi.method} ${path}, another api is already registered`,
                )
            }
            if (!node.__apidef__) {
                node.__apidef__ = {
                    type: 'api',
                    path,
                    registeredPath: path,
                    methods: {},
                    params: {},
                } as HttpPathResolution
            }
            node.__apidef__.methods[newApi.method] = newApi
            return node.__apidef__
        }
        const registeredDef = node.__apidef__ as HttpPathResolution
        if (!registeredDef) {
            return null
        }
        return {
            type: 'api',
            path,
            methods: registeredDef.methods,
            registeredPath: registeredDef.registeredPath,
            params: paramCollector,
        } as HttpPathResolution
    }

    private destroyAllWorkers() {
        const proms: Promise<any>[] = []
        for (const workerClass of Object.keys(this.workerFleet)) {
            const fleet = this.workerFleet[workerClass]
            for (const worker of fleet.workers) {
                const terminationProm = worker.terminate()
                proms.push(terminationProm)
                ProcessExit.gracefulExitPromises.push(terminationProm)
            }
        }
        this.workerFleet = {}
        return PromUtil.allSettled(proms)
    }
}

export * from './shim/http.shim.cache'
export * from './shim/http.shim.decorators'
export * from './shim/http.shim.handlers'
export * from './shim/http.shim.op'
export * from './shim/http.shim.types'
export * from './shim/http.shim.io'
