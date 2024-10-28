import { promise } from './prom.util'

export type Response2<T = any> = Response & {
    stackTrace?: Error
    request: {
        url: RequestInfo | URL
        init?: RequestInit
    }
    getData: () => Promise<T>
}

export async function fetchSafe<T = any>(
    url: RequestInfo | URL,
    init?: RequestInit,
) {
    return promise<Response2>(resolve => {
        fetch(url, init)
            .then(res => {
                ;(res as any).request = { url, init }
                ;(res as any).getData = async () => {
                    try {
                        const body = await res.text()
                        return JSON.parse(body)
                    } catch (e) {
                        return null
                    }
                }
                resolve(res as Response2<T>)
            })
            .catch(res => {
                ;(res as any).request = { url, init }
                ;(res as any).getData = async () => {
                    try {
                        const body = await res.text()
                        return JSON.parse(body)
                    } catch (e) {
                        return null
                    }
                }
                resolve(res as Response2)
            })
    })
}

export async function fetchJson(url: RequestInfo | URL, init?: RequestInit) {
    const res = await fetchSafe(url, init)
    return JSON.parse(await res.text())
}

export async function fetchText(url: RequestInfo | URL, init?: RequestInit) {
    const res = await fetchSafe(url, init)
    return await res.text()
}
