import { promise } from '@jovian/type-tools'
import { HttpServerShim } from '../../http.shim'
import { HttpOp } from '../http.shim.op'
import { HttpParams, HttpServerShimApi } from '../http.shim.types'
import { isJsonString } from '../../../../src'

export function expressHandler(server: HttpServerShim, api: HttpServerShimApi) {
    return async (oriReq, oriRes) => {
        const op = new HttpOp(server, api, oriReq, oriRes)
        op.method = oriReq.method
        await op.run()
    }
}

export function expressParseQuery(op: HttpOp): HttpParams {
    if (op.req.queryParamsParsed) {
        return op.req.params
    }
    op.req.queryParamsParsed = true
    if (!op.req.params) {
        op.req.params = op.oriReq.params ? op.oriReq.params : {}
    }
    let queryParamNames: string[]
    if (op.oriReq.query) {
        queryParamNames = Object.keys(op.oriReq.query)
        if (queryParamNames.length > 0) {
            for (const queryParamName of queryParamNames) {
                op.req.params[queryParamName] = op.oriReq.query[queryParamName]
            }
        }
    }
    return op.req.params
}

export function expressParseBody(op: HttpOp): Promise<boolean> {
    return promise(resolve => {
        let errored = false
        const chunks: Buffer[] = []
        op.oriReq.on('data', chunk => {
            chunks.push(chunk)
        })
        op.oriReq.on('end', () => {
            try {
                expressParseQuery(op)
                op.req.bodyRaw = Buffer.concat(chunks)
                const bod = (op.req.body = op.req.bodyRaw.toString())
                if (op.oriReq.headers['encrypted-api']) {
                    if (op.req.params['__enc']) {
                        op.req.encryptedPayload = op.req.params['__enc']
                    } else {
                        op.req.encryptedPayload = bod
                    }
                    const prepareResult =
                        op.server.prepareEncryptedOperation(op)
                    if (prepareResult.bad) {
                        op.raise(prepareResult)
                        return resolve(false)
                    }
                } else {
                    op.params = op.req.params
                    op.req.body = op.req.bodyRaw.toString()
                    if (isJsonString(op.req.body)) {
                        try {
                            op.req.data = JSON.parse(op.req.body)
                            if (
                                typeof op.req.data === 'object' &&
                                !Array.isArray(op.req.data)
                            ) {
                                Object.assign(op.req.params, op.req.data)
                            }
                        } catch (e) {
                            console.error('BAD_JSON', e)
                        }
                    }
                }
                resolve(true)
            } catch (e) {
                resolve(false)
                console.error(e)
            }
        })
        op.oriReq.on('error', e => {
            console.error(e)
            errored = true
            resolve(false)
        })
    })
}
