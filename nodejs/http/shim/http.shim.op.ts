import { errorResult, HttpMethod, Result } from '../../../src'
import { SecureChannel } from '../../secure-channel/secure-channel'
import { HttpServerShim } from '../http.shim'
import { HttpCacheOp } from './http.shim.cache'
import { HttpShimCode, HttpShimCodeEnum } from './http.shim.codes'
import { HttpRequest, HttpResponse } from './http.shim.io'
import {
    ErrorObject,
    HttpBaseLib,
    HttpOpDef,
    HttpOpIface,
    HttpParams,
    HttpServerShimApi,
} from './http.shim.types'

export class HttpOp<Params = HttpParams, Returns = any>
    implements HttpOpIface<Params, Returns>
{
    method: HttpMethod
    params: Params
    req: HttpRequest<Params, Returns>
    res: HttpResponse<Params, Returns>
    error: ErrorObject = null
    errors: ErrorObject[] = []
    secureChannel: SecureChannel
    cache: HttpCacheOp<Params, Returns>
    pendingSequential: Promise<any>[] = []
    pendingParallel: Promise<any>[] = []
    user: {
        username: string
        publicKeys: string[]
        roles: string[]
        rolesApplicable: string[]
    }
    auth: {
        authorization?: string
    } = {}
    fromInternal: boolean
    endingDeferred: boolean
    opDef?: HttpOpDef
    constructor(
        public server: HttpServerShim,
        public api: HttpServerShimApi<Params, Returns>,
        public oriReq: any = null,
        public oriRes: any = null,
    ) {
        this.params = {} as any
        this.req = new HttpRequest<Params, Returns>(this)
        this.req.params = this.params
        this.res = new HttpResponse<Params, Returns>(this)
        this.res.req = this.req
        this.req.res = this.res
        this.cache = new HttpCacheOp<Params, Returns>(this)
    }
    get roleBook() {
        return this.server.apiAccess[this.api.handlerName]
    }
    raise(result: Result, statusCode?: number): Result
    raise(error: Error, statusCode?: number): Result
    raise(
        statusCode: number,
        errorCode: keyof typeof HttpShimCodeEnum,
        message?: string,
    ): Result
    raise(...args): Result {
        if (typeof args[0] === 'number') {
            const [statusCode, errorCode, message] = args as [
                number,
                keyof typeof HttpShimCodeEnum,
                string,
            ]
            if (!this.res.ended) {
                this.res.returnNotOk(statusCode, message)
            }
            return HttpShimCode.error(errorCode, message, { statusCode }) as any
        } else {
            if (args[0] instanceof Error) {
                args[0] = errorResult(args[0])
            }
            let [result, statusCode] = args as [Result, number]
            if (result.ok) {
                if (!statusCode) {
                    statusCode = result.statusCode ? result.statusCode : 200
                }
                if (!this.res.ended) {
                    this.res.status(statusCode).returnJson(result.data)
                }
            } else {
                if (!statusCode) {
                    statusCode = result.statusCode ? result.statusCode : 500
                }
                if (!this.res.ended) {
                    this.res.returnNotOk(statusCode, result.message)
                }
            }
            return result
        }
    }
    returnJson(obj: Returns) {
        let status = 'ok'
        let result = obj
        if (obj && (obj as any).isResultKind) {
            const res = obj as any as Result
            if (res.bad) {
                status = 'error'
                result = res.message as any
            } else {
                result = res.data
            }
            if (res.statusCode) {
                this.res.status(res.statusCode)
            }
        }
        if (this.server.config.showServerInfo) {
            const serverInfo = `${this.server.config.indexKey} (${this.server.config.name})`
            if (status === 'error') {
                this.res.end(
                    JSON.stringify({
                        status,
                        message: result,
                        server: serverInfo,
                    }),
                    obj,
                )
            } else {
                this.res.end(
                    JSON.stringify({ status, result, server: serverInfo }),
                    obj,
                )
            }
        } else {
            if (status === 'error') {
                this.res.end(JSON.stringify({ status, message: result }), obj)
            } else {
                this.res.end(JSON.stringify({ status, result }), obj)
            }
        }
        return obj
    }
    setResponse(endingPayload?: string | Buffer) {
        if (endingPayload) {
            this.res.endingPayload = endingPayload
        }
    }
    addSequentialProcess(proc: Promise<any>) {
        this.pendingSequential.push(proc)
        return proc
    }
    deferEnding() {
        this.endingDeferred = true
    }
    waitFor(resolver: (resolve) => void) {
        const proc = new Promise(resolver)
        this.pendingSequential.push(proc)
        return proc
    }
    async run(fromInternal = false) {
        this.fromInternal = fromInternal
        // try {
        //   const onBeforeRes = await this.opDef?.callbacks?.onBefore?.(this)
        //   if (onBeforeRes === false) {
        //     this.raise(HttpShimCode.error('HTTP_SERVER_ONBEFORE_BLOCKS_REQ'))
        //     this.finish()
        //     return
        //   } else if (onBeforeRes?.isResultKind && onBeforeRes.status !== 'ok') {
        //     this.raise(onBeforeRes)
        //     this.finish()
        //     return
        //   }
        // } catch (e) {
        //   this.raise(HttpShimCode.error('HTTP_SERVER_ONBEFORE_ERROR'))
        //   this.finish()
        //   return
        // }
        // if (!this.server.state.serverInit) {
        //   this.raise(HttpShimCode.error('HTTP_SERVER_NOT_INITIALIZED'))
        //   this.finish()
        //   return
        // }
        const preRes = await this.server.handlePre(this)
        if (preRes) {
            await this.server[this.api.handlerName](this)
            for (const prom of this.pendingSequential) {
                await Promise.resolve(prom)
            }
        }
        await this.server.handlePost(this)
        if (this.secureChannel) {
            this.res.endingPayloadRaw = this.res.endingPayload
            this.res.endingPayload = JSON.stringify({
                status: 'ok',
                format: 'json',
                encrypted: true,
                payload: this.secureChannel.createWrappedPayload(
                    this.res.endingPayload,
                ),
            })
        }
        if (!this.endingDeferred) {
            try {
                this.opDef?.callbacks?.onAfter?.(this)
            } catch (e) {}
            this.finish()
        }
    }
    finish(): null {
        switch (this.server.config.type) {
            case HttpBaseLib.EXPRESS:
                this.oriRes
                    .status(this.res.statusCode)
                    .end(this.res.endingPayload)
                return null
            default:
                throw new Error(
                    `Unknown base http library type: ${this.server.config.type}`,
                )
        }
    }
}
