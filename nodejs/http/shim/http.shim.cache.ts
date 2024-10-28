import { HttpShimCode } from './http.shim.codes'
import { HttpCode, Class, Result } from '../../../src'
import { HttpParams } from './http.shim.types'
import { HttpOp } from './http.shim.op'

export enum CacheParser {
    JSON = 'JSON',
}

export class CacheDef<T = any> {
    path: string
    class: Class<T>
    keys: { name: string; type: 'param' | 'fixed' }[] = null
    keysExceptLast: { name: string; type: 'param' | 'fixed' }[] = null
    lastKey: { name: string; type: 'param' | 'fixed' } = null
    serializer: CacheParser
    maxOld: number = 0
    matchExactly: boolean = false
    defStack: string = ''
    constructor(init?: Partial<CacheDef<T>>) {
        if (init) {
            Object.assign(this, init)
        }
        if (this.path.indexOf('/') >= 0) {
            this.keys = []
            const keys = this.path.split('/').slice(1)
            for (const keyname of keys) {
                if (keyname.startsWith(':')) {
                    this.keys.push({
                        name: keyname.split(':')[1],
                        type: 'param',
                    })
                } else {
                    this.keys.push({ name: keyname, type: 'fixed' })
                }
            }
            this.lastKey = this.keys[this.keys.length - 1]
            this.keysExceptLast = this.keys.slice(0, -1)
        }
        if (!this.serializer) {
            this.serializer = CacheParser.JSON
        }
    }
}

export interface CacheAccessOption {
    version?: number | string
    pathParams?: { [name: string]: string }
    serialized?: string | Buffer
    serializedResponse?: string | Buffer
    matchExactly?: boolean
}

export class CacheEntry<T = any> {
    hasValue?: boolean
    value: T
    rootNode: any
    version: number | string
    serialized?: string | Buffer
    serializedResponse?: string | Buffer
    hits: number
    def: CacheDef<T>
    constructor(init?: Partial<CacheEntry>) {
        if (init) {
            Object.assign(this, init)
        }
    }
    asResponse(): string | Buffer {
        if (this.serializedResponse) {
            return this.serializedResponse
        }
    }
    asSerialized(): string | Buffer {
        return this.serialized
    }
    getData(option?: CacheAccessOption) {
        const nav = this.keyNavigate(option)
        return nav.target[nav.key] as T
    }
    keyNavigate(option?: CacheAccessOption) {
        if (this.def.keys) {
            if (!this.rootNode) {
                this.rootNode = {}
            }
            let node = this.rootNode
            for (const keyInfo of this.def.keysExceptLast) {
                const key = this.resolvePathKey(keyInfo, option)
                if (!node[key]) {
                    node[key.name] = {}
                }
                node = node[key]
            }
            const lastKeyStr = this.resolvePathKey(this.def.lastKey, option)
            return { key: lastKeyStr, target: node as any }
        } else {
            return { key: 'value', target: this as any }
        }
    }
    resolvePathKey(
        keyInfo: { name: string; type: 'param' | 'fixed' },
        opt?: CacheAccessOption,
    ) {
        let key
        if (keyInfo.type === 'fixed') {
            key = keyInfo.name
        } else {
            if (!opt?.pathParams) {
                throw new Error(
                    `Cannot naviagate cache path '${this.def.path}'. param not given`,
                )
            }
            const paramValue = opt?.pathParams?.[keyInfo.name]
            if (!paramValue) {
                throw new Error(
                    `Cannot naviagate cache path '${this.def.path}'. param '${keyInfo.name}' not found`,
                )
            }
            key = paramValue
        }
        if (!key) {
            throw new Error(
                `Cannot naviagate cache path '${this.def.path}; Params = ${opt.pathParams}`,
            )
        }
        return key
    }
}

export class HttpCacheOp<Params = HttpParams, Returns = any> {
    constructor(public op: HttpOp<Params, Returns>) {}
    async handler<T>(
        cacheDef: CacheDef<T>,
        option: CacheAccessOption,
        dataResolver: (
            resolve: (data: T) => void,
            reject: (e: Result<any>) => void,
        ) => void,
    ) {
        if (!option) {
            option = {}
        }
        if (!option.pathParams) {
            option.pathParams = {}
        }
        if (this.op.req.params) {
            Object.assign(option.pathParams, this.op.req.params)
        }
        const entry = this.cacheEntryGet(cacheDef, option)
        const matched = entry ? true : false
        return this.op.addSequentialProcess(
            new Promise<void>(procResolve => {
                const resolve = (data: T, cacheEntry?: CacheEntry<T>) => {
                    if (matched && cacheEntry?.serializedResponse) {
                        this.op.setResponse(
                            cacheEntry.serializedResponse as string,
                        )
                        return procResolve()
                    }
                    let dataString
                    let responseString
                    switch (cacheDef.serializer) {
                        case CacheParser.JSON:
                            dataString = option.serialized =
                                JSON.stringify(data)
                            responseString = option.serializedResponse =
                                this.op.res.okJsonPreserialized(dataString)
                            break
                    }
                    this.cacheSet(cacheDef, data, option)
                    this.op.setResponse(responseString)
                    return procResolve()
                }
                const reject = (result: Result<any>) => {
                    this.op.raise(result)
                    return procResolve()
                }
                if (matched) {
                    resolve(entry.getData(option), entry)
                } else {
                    try {
                        dataResolver(resolve, reject)
                    } catch (e) {
                        this.op.raise(
                            HttpShimCode.error('CACHE_DATA_FETCH_FAILED'),
                            HttpCode.INTERNAL_SERVER_ERROR,
                        )
                        return procResolve()
                    }
                }
            }),
        )
    }
    cacheEntryGet(cacheDef: CacheDef, option?: CacheAccessOption) {
        const cacheData = this.op.server.cacheData[cacheDef.path]
        if (!cacheData || !cacheData.hasValue) {
            return null
        }
        const matchExactly = cacheDef.matchExactly
            ? true
            : option.matchExactly
              ? true
              : false
        if (matchExactly) {
            if (
                option &&
                option.version &&
                option.version !== cacheData.version
            ) {
                return null // looking to match time/version exactly, but didn't match.
            }
        } else {
            if (
                cacheData.def.maxOld !== 0 && // 0 means no expiry
                Date.now() - (cacheData.version as number) >
                    cacheData.def.maxOld
            ) {
                return null // too old
            }
        }
        ++cacheData.hits
        return cacheData
    }
    cacheSet<T>(cacheDef: CacheDef<T>, value: T, option?: CacheAccessOption) {
        if (!this.op.server.cacheData[cacheDef.path]) {
            throw new Error(
                `Cache key '${cacheDef.path}' is not defined ahead-of-time for this server.`,
            )
        }
        const cacheData = this.op.server.cacheData[cacheDef.path]
        const setter = cacheData.keyNavigate(option)
        setter.target[setter.key] = value
        if (option?.version) {
            cacheData.version = option.version
        } else {
            cacheData.version = Date.now()
        }
        if (option?.serialized) {
            cacheData.serialized = option.serialized
        }
        if (option?.serializedResponse) {
            cacheData.serializedResponse = option.serializedResponse
        }
        cacheData.hasValue = true
        return cacheData
    }
    cacheUnset(cacheDef: CacheDef) {
        const cacheData = this.op.server.cacheData[cacheDef.path]
        if (cacheData) {
            cacheData.hasValue = false
        }
        return cacheData
    }
}
