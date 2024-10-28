import { Class, HttpCode, HttpMethod } from '../../../src'
import { HttpServerShim } from '../http.shim'
import {
    HttpApiOptions,
    HttpApiRoleAccess,
    HttpMethodRegistration,
    HttpMethodsRegistration,
    HttpParams,
    HttpServerShimApi,
    ShimHttpDecorator,
} from './http.shim.types'

export function isClass(target) {
    return !!target.prototype && !!target.constructor.name
}

export function methodsRegister<Params = any, RoleBook = any>(
    httpMethods: HttpMethod[],
    path: string,
    apiOptions?: HttpApiOptions<RoleBook>,
) {
    path = path.replace(/\/\//g, '/')
    return <T = any>(method: T, deco: ShimHttpDecorator<HttpServerShim>) => {
        deco.addInitializer(function () {
            const sourceClass = this.constructor as Class<any>
            for (const httpMethod of httpMethods) {
                const apiKey = `${httpMethod} ${path}`
                const methodApi: HttpServerShimApi<Params> = {
                    class: sourceClass,
                    className: sourceClass.name,
                    method: httpMethod,
                    path,
                    handlerName: deco.name as string,
                }
                if (apiOptions) {
                    Object.assign(methodApi, apiOptions)
                }
                if (!this.apiMap) {
                    this.apiMap = {}
                }
                this.apiMap[apiKey] = methodApi
                if (!this.apiRegistrations) {
                    this.apiRegistrations = []
                }
                this.addRegistration(methodApi)
            }
        })
        return method
    }
}

/**
 * HTTP api registration decorator
 */

export class HTTP {
    static GET = (<Params = HttpParams>(
        path: string,
        apiOptions?: HttpApiOptions<Params>,
    ) => {
        return methodsRegister([HttpMethod.GET], path, apiOptions)
    }) as HttpMethodRegistration & Class<any>
    static POST = (<Params = HttpParams>(
        path: string,
        apiOptions?: HttpApiOptions<Params>,
    ) => {
        return methodsRegister([HttpMethod.POST], path, apiOptions)
    }) as HttpMethodRegistration & Class<any>
    static PATCH = (<Params = HttpParams>(
        path: string,
        apiOptions?: HttpApiOptions<Params>,
    ) => {
        return methodsRegister([HttpMethod.PATCH], path, apiOptions)
    }) as HttpMethodRegistration & Class<any>
    static PUT = (<Params = HttpParams>(
        path: string,
        apiOptions?: HttpApiOptions<Params>,
    ) => {
        return methodsRegister([HttpMethod.PUT], path, apiOptions)
    }) as HttpMethodRegistration & Class<any>
    static DELETE = (<Params = HttpParams>(
        path: string,
        apiOptions?: HttpApiOptions<Params>,
    ) => {
        return methodsRegister([HttpMethod.DELETE], path, apiOptions)
    }) as HttpMethodRegistration & Class<any>
    static CRUD = (<Params = HttpParams>(
        path: string,
        apiOptions?: HttpApiOptions<Params>,
    ) => {
        return methodsRegister(
            [
                HttpMethod.POST,
                HttpMethod.GET,
                HttpMethod.PATCH,
                HttpMethod.PUT,
                HttpMethod.DELETE,
            ],
            path,
            apiOptions,
        )
    }) as HttpMethodRegistration & Class<any>
    static METHODS = (<Params = HttpParams>(
        methods: HttpMethod[],
        path: string,
        apiOptions?: HttpApiOptions<Params>,
    ) => {
        return methodsRegister(methods, path, apiOptions)
    }) as HttpMethodsRegistration & Class<any>
    static ACCESS = <RoleBook extends { [roleName: string]: any } = any>(
        access: HttpApiRoleAccess<RoleBook> | 'allow-all' | 'deny-all',
    ) => {
        return <T = any>(
            method: T,
            deco: ShimHttpDecorator<HttpServerShim>,
        ) => {
            deco.addInitializer(function () {
                if (typeof access === 'string') {
                    const strAccess = access
                    access = {}
                    Object.defineProperty(access, strAccess, { value: true })
                }
                if (!access.class) {
                    Object.defineProperty(access, 'class', {
                        value: this.constructor,
                    })
                }
                this.addAccessRule(
                    deco.name as any,
                    access as HttpApiRoleAccess<RoleBook, HttpParams>,
                )
            })
            return method
        }
    }
    static ACL = this.ACCESS
    static SHIM = {
        ROOT_API_PROXY_REQUEST: '/proxy-request',
        ROOT_API_PUBLIC_INFO: '/public-info',
        ROOT_API_NEW_CHANNEL: '/secure-channel',
        ROOT_API_SECURE_API: '/secure-api',
        ROOT_API_ROLES_TEST: '/test-roles-api',
    }
    static STATUS = HttpCode
}
