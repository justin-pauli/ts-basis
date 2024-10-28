import { HttpOp } from './http.shim.op'
import { HttpBaseLib, HttpParams, HttpServerShimApi } from './http.shim.types'

export class HttpRequest<Params = HttpParams, Returns = any> {
    op: HttpOp<Params, Returns>
    res: HttpResponse<Params, Returns>
    data: any
    body: string = null
    bodyRaw: Buffer = null
    headers: { [headerName: string]: string } = {}
    params: Params
    encryptedPayload: string
    decryptedPayload: string
    decryptedPayloadObject: object | any[]
    decryptedApiTarget: HttpServerShimApi<HttpParams, any>
    queryParamsParsed: boolean
    t = Date.now()
    constructor(op: HttpOp<Params, Returns>) {
        this.op = op
    }
    getHeader(headerName: string): string {
        switch (this.op.server.config.type) {
            case HttpBaseLib.EXPRESS:
                return this.op.oriReq.header(headerName)
            default:
                return null
        }
    }
}

export class HttpResponse<Params = HttpParams, Returns = any> {
    op: HttpOp<Params, Returns>
    req: HttpRequest<Params, Returns>
    headers: { [headerName: string]: string } = {}
    t = -1
    dt = -1
    ended = false
    output = []
    endingPayload: string | Buffer = ''
    endingPayloadRaw: string | Buffer = ''
    statusCode: number = 200
    appErrorCode: number | string = 'GENERIC_ERROR'
    returnValue?: Returns
    private onends: (() => any)[] = []
    constructor(op: HttpOp<Params, Returns>) {
        this.op = op
    }
    get onend() {
        return this.onends
    }
    send(payload: string) {
        if (this.ended) {
            return
        }
        this.op.oriRes.send(payload)
        this.output.push(payload)
        return this
    }
    end(payload: string, returnValue?: Returns) {
        if (this.ended) {
            return
        }
        this.ended = true
        this.t = Date.now()
        this.dt = this.t - this.req.t
        for (const onend of this.onends) {
            try {
                if (onend) {
                    onend()
                }
            } catch (e) {}
        }
        this.endingPayload = payload
        this.output.push(payload)
        if (returnValue !== undefined) {
            this.returnValue = returnValue
        }
        return this
    }
    status(num: number) {
        this.statusCode = num
        return this
    }
    returnCached(code: number, cached: string) {
        this.statusCode = code
        return this.end(cached)
    }
    returnNotOk(code: number, message: any = '') {
        let errorName = 'unclassified_server_error'
        switch (code) {
            case 400:
                errorName = 'bad_request'
                break
            case 401:
                errorName = 'unauthorized'
                break
            case 404:
                errorName = 'not_found'
                break
            case 500:
                errorName = 'internal_server_error'
                break
        }
        const resObj: any = {
            status: 'error',
            errorName,
            message,
        }
        if (!message && this.op.errors.length > 0) {
            const e = this.op.errors[0].e
            message = e.message
            if (this.op.server.config.debug.showErrorStack) {
                resObj.stackTrace = e.stack
            }
        }
        this.statusCode = code
        return this.end(JSON.stringify(resObj))
    }

    okJsonPreserialized(serial: string) {
        return `{"status":"ok","result":${serial}}`
    }
    okJsonString(obj: any) {
        return JSON.stringify({ status: 'ok', result: obj })
    }
    returnJsonPreserialized(serialized: string, original?: Returns) {
        this.end(`{"status":"ok","result":${serialized}}`)
        return original
    }
    returnJson(obj: Returns) {
        this.end(JSON.stringify({ status: 'ok', result: obj }), obj)
        return obj
    }
}
