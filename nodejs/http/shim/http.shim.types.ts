import {
    Class,
    completeConfig,
    configBoolean,
    HttpMethod,
    Logger,
    Promise2,
    RequiredType,
    Result,
} from '../../../src'
import { Entity } from '../../../src/common/ix'
import {
    AccessHeaderObject,
    SecureChannelPayload,
    SecureChannelTypes,
} from '../../../src/common/security/security.common'
import { AsyncWorkerClient } from '../../proc/async.worker.proc'
import { SecureChannel } from '../../secure-channel/secure-channel'
import { DestorClient } from '../destor/destor.client'
import { HttpServerShim } from '../http.shim'
import {
    CacheDef,
    CacheEntry,
    CacheParser,
    HttpCacheOp,
} from './http.shim.cache'
import { HttpShimCodeEnum } from './http.shim.codes'
import { ServerConstDataGlobal } from './http.shim.global.conf'
import { PostHandler, PreHandler } from './http.shim.handlers'
import { HttpRequest, HttpResponse } from './http.shim.io'
import { HttpOp } from './http.shim.op'

export enum ReqProcessor {
    AUTH = 'AUTH',
    BASIC = 'BASIC',
    DECRYPT = `DECRYPT`,
    ENCRYPT = `ENCRYPT`,
}

export interface ServerStartOptions {
    port: number
}

export interface HttpParams {
    [paramName: string]: any
}

type PropType<TObj, TProp extends keyof TObj> = TObj[TProp]
export type ParamDef<T extends HttpOpParamDef> = {
    [key in keyof T]: PropType<T[key], 'default'>
}
export type HttpOpParamDef = {
    [key: string]: {
        type: string
        default: any
        required?: boolean | Class<any>
    }
}
export type HttpOpDef<T = any> = {
    env?: any
    params: {
        [key: string]: {
            type: string
            default: any
            required?: boolean | Class<any>
            validate?: (v: any) => boolean | Promise<boolean>
        }
    }
    callbacks?: {
        onBefore?: (op: HttpOp) => any
        onAfter?: (op: HttpOp) => any
    }
    returns: {
        type: string
        default: any
    }
}
export type HttpOpType<T extends HttpOpDef> = HttpOp<
    ParamDef<T['params']>,
    T['returns']['default']
>

export class HttpApiOptions<Params = HttpParams, Returns = any> {
    rootMount?: configBoolean
    rootVersionMount?: configBoolean
    builtIn?: configBoolean
    hidden?: configBoolean
    pre?: string[]
    post?: string[]
    preExclude?: string[]
    postExclude?: string[]
    headerOptions?: {
        authFromQueryParamName?: string
        noContentType?: boolean
    }
}

export type HttpApiRoleAccess<RoleBook, Params = HttpParams> = {
    [key in keyof RoleBook]?:
        | configBoolean
        | Class<any>
        | {
              [param in keyof Params]?: ValueConstraintRules
          }
}

export type ShimMethodDecorator<T = unknown> = ClassMethodDecoratorContext<
    T,
    (this: T, op: HttpOp<any>) => any
>
export type ShimFieldDecorator<T = unknown> = ClassFieldDecoratorContext<
    T,
    (this: T, op: HttpOp<any>) => any
>
export type ShimHttpDecorator<T = unknown> =
    | ShimMethodDecorator<T>
    | ShimFieldDecorator<T>

export type HttpOpParamType =
    | 'string'
    | 'string-base64'
    | 'string-bigint'
    | 'number'
    | 'boolean'
    | 'configBoolean'
    | 'array'
    | 'object'

export class HttpServerShimApi<
    Params = HttpParams,
    Returns = any,
> extends HttpApiOptions<Params, Returns> {
    class: Class<any>
    className: string
    server?: HttpServerShim
    path = ''
    apiPath?: string
    apiVersion?: string
    public?: boolean
    fullpath?: string = ''
    method = HttpMethod.GET
    handlerName?: string
    parameters?: { [paramName in keyof Params]: HttpOpParamType }
    preDefaultProcesserAdded?: boolean
    postDefaultProcesserAdded?: boolean
    preProcesserExcludesAdded?: boolean
    postProcesserExcludesAdded?: boolean
    registered?: boolean
}

export enum HttpBaseLib {
    EXPRESS = 'EXPRESS',
}

export interface HttpShimPublicInfo<RoleBook = any> {
    tokenRequired: boolean
    accessorRequired: boolean
    secureChannelScheme: SecureChannelTypes
    secureChannelPublicKey: string
    secureChannelStrict: boolean
    secureChannelRequired: boolean
    apiPathList: string[]
    apiInterface: { [methodName: string]: HttpApiRoleAccess<RoleBook> }
}

export type ValueConstraint = [
    'is' | 'exactly' | 'pattern' | 'startsWith',
    string | number | boolean,
]
export type ValueConstraintRules = (
    | ValueConstraint
    | 'OR'
    | 'AND'
    | '('
    | ')'
)[]

export interface HttpServerShimConfig {
    indexKey?: string
    name?: string
    env?: string
    type: HttpBaseLib | string
    scopeName?: string
    debug?: {
        showErrorStack?: boolean
    }
    cache?: {
        defaultCacheParser?: CacheParser
    }
    security?: {
        noauth?: boolean
        token?: {
            required?: RequiredType
            value: string
            role: string | string[]
            custom?: boolean
            customHandler?: (
                op: HttpOp,
                authorizationHeader: string,
            ) => Promise<Result<boolean>>
        }
        userToken?: {
            required?: RequiredType
            map: {
                [token: string]: {
                    user: string
                    role: string | string[]
                }
            }
            custom?: boolean
            customHandler?: (
                op: HttpOp,
                authorizationHeader: string,
            ) => Promise<Result<boolean>>
        }
        accessor?: {
            required?: RequiredType
            baseToken?: string
            baseTokenBuffer?: Buffer
            timeHashed?: boolean
            timeWindow?: number
            role?: string | string[]
        }
        secureChannel?: {
            required?: RequiredType
            enabled?: boolean
            strict?: boolean
            encryption?: SecureChannelTypes
            publicKey?: string
            signingKey?: string
        }
    }
    workers?: {
        secureChannelWorkers?: {
            initialCount?: number
        }
    }
    startOptions?: ServerStartOptions
    skipConfigSecretResolution?: boolean
    skipAuthServerResolution?: boolean
    showServerInfo?: boolean
    waitForServerInit?: boolean
}

export type Tail<T extends any[]> = ((...t: T) => void) extends (
    h: any,
    ...r: infer R
) => void
    ? R
    : never
export type Last<T extends any[]> = T[Exclude<keyof T, keyof Tail<T>>]
export type HttpMethodRegistration = <Params = HttpParams>(
    path: string,
    apiOptions?: HttpApiOptions<Params, any>,
) => <T = any>(method: T, deco: ShimHttpDecorator<HttpServerShim>) => T
export type HttpMethodsRegistration = <Params = HttpParams>(
    methods: HttpMethod[],
    path: string,
    apiOptions?: HttpApiOptions<Params, any>,
) => <T = any>(method: T, deco: ShimHttpDecorator<HttpServerShim>) => T

export class HttpPathResolution {
    type: 'api' | 'resource'
    path: string
    methods: { [method: string]: HttpServerShimApi }
    registeredPath: string
    params: { [paramName: string]: string }
}

export interface ErrorObject {
    op: HttpOp
    t: number
    e: Error
    errorMessage: string
    httpStatusCode: number
    appErrorCode: number | string
}

export interface HttpOpIface<Params = HttpParams, Returns = any> {
    method: HttpMethod
    params: Params
    req: HttpRequest<Params, Returns>
    res: HttpResponse<Params, Returns>
    error: ErrorObject
    errors: ErrorObject[]
    secureChannel: SecureChannel
    cache: HttpCacheOp<Params, Returns>
    pendingSequential: Promise<any>[]
    pendingParallel: Promise<any>[]
    user: {
        username: string
        publicKeys: string[]
        roles: string[]
        rolesApplicable: string[]
    }
    auth: {
        authorization?: string
    }
    fromInternal: boolean
    endingDeferred: boolean
    opDef?: HttpOpDef

    raise(result: Result, statusCode?: number): Result
    raise(error: Error, statusCode?: number): Result
    raise(
        statusCode: number,
        errorCode: keyof typeof HttpShimCodeEnum,
        message?: string,
    ): Result

    returnJson(obj: Returns): Returns
    setResponse(endingPayload?: string | Buffer): void
    addSequentialProcess(proc: Promise<any>): Promise<any>
    deferEnding(): void
    waitFor(resolver: (resolve) => void): Promise<any>
    run(fromInternal: boolean): void
    finish(): any
}

export interface HttpServerShimType<RoleRubric = any> extends Entity {
    config: HttpServerShimConfig
    configGlobal: ServerConstDataGlobal
    configResolutionPromise: Promise<any>
    publicInfo: any
    publicInfoString: string
    baseApp: any
    authServers: {
        [url: string]: {
            type: 'jwt' | '4q_stamp'
            publicKey: string
            token?: string
        }
    }
    apiPath: string
    apiVersion: string
    apiRegistrations: HttpServerShimApi[]
    apiAccess: { [methodName: string]: HttpApiRoleAccess<RoleRubric> }
    apiMap: { [key: string]: HttpServerShimApi }
    apiPathList: string[]
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
    }
    rolebook: RoleRubric | { [roleName: string]: any }
    logger: Logger
    destor: DestorClient
    destorPromise: Promise2<DestorClient>
    pathTree: { [key: string]: any }
    preHandler: PreHandler
    postHandler: PostHandler
    defaultProcessors: ReqProcessor[]
    proxyRequest: {
        enabled: boolean
        requestCheckers?: ((params: {
            [paramName: string]: any
        }) => Promise2<{ allowed: boolean; message?: string }>)[]
    }
    secureChannels: { [channelId: string]: SecureChannel }
    workerFleet: {
        [workerFleetClassName: string]: { workers: AsyncWorkerClient[] }
    }
    cacheData: { [key: string]: CacheEntry }
    extData: any
    state: {
        serverInit: boolean
        activePort: number
        closed: boolean
        started: boolean
        apiRegistered: boolean
        apiRegisterStack: any
        closingPromise: Promise<any>
    }
    baseLibData: {
        express: {
            server: any
        }
    }

    configResolution(): Promise<void>

    registerApis(): void

    normalizeServerConfig(config: HttpServerShimConfig): HttpServerShimConfig

    addDefaultProcessor(...processors: ReqProcessor[]): void

    cacheDefine<T = any>(init?: Partial<CacheDef<T>>): CacheDef<T>

    addWorker<T extends AsyncWorkerClient>(
        workerClass: Class<T>,
        workerData?: { [key: string]: any },
    ): any

    pickWorker<T extends AsyncWorkerClient>(workerClass: Class<T>): T

    setBaseLayer(): void

    setFinalLayer(): void

    setServerInitStatus(v: boolean): void

    getDestorClient(): Promise<DestorClient>
    getRoles(op: HttpOp<{}>): Promise<void>
    getServerPublicInfo(op: HttpOp<{}>): Promise<any>

    newSecureChannel(op: HttpOp): Promise<any>
    encryptedOperation(op: HttpOp<{}>, skipRunning?: boolean): Promise<void>
    proxyRequestOperation(op: HttpOp): Promise<any>

    addAccessRule(
        memberMethodName: keyof HttpServerShimType,
        access: HttpApiRoleAccess<RoleRubric>,
    ): void

    addRegistration(api: HttpServerShimApi): void
    addPublicInfo(info: { [infoKey: string]: any }): void

    register(api: HttpServerShimApi): void

    beforeStart(): void
    afterStart(): void
    afterConfigResolution(): void
    beforeStop(): void
    afterStop(): void

    start(options?: ServerStartOptions): Promise<void>

    close(): Promise<any>

    stamp(
        payload?: string | Buffer,
        encoding?: BufferEncoding,
    ): Promise<{ payload: string; sig: string }>

    prepareEncryptedOperation(op: HttpOp): Result<HttpServerShimApi>

    checkAccessor<Params = HttpParams, Returns = any>(
        op: HttpOp<Params, Returns>,
        forceVerify?: boolean,
    ): Result<
        Partial<AccessHeaderObject> &
            Partial<{ accessor: string; t: number; channelPublicKey?: string }>
    >

    getSecureChannel<Params = HttpParams, Returns = any>(
        op: HttpOp<Params, Returns>,
    ): Result<SecureChannel>

    getDecryptedPayload<Params = HttpParams, Returns = any>(
        op: HttpOp<Params, Returns>,
    ): Result<string>

    handlePre<Params = HttpParams, Returns = any>(
        op: HttpOp<Params, Returns>,
    ): Promise<boolean>

    handlePost<Params = HttpParams, Returns = any>(
        op: HttpOp<Params, Returns>,
    ): Promise<boolean>

    getApiEnv(): any
}
