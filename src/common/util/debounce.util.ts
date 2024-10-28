import { log } from '../logger/logger'

export class Debounce {
    static named: { [name: string]: Debounce } = {}

    name?: string
    time: number
    timer: any
    func?: () => any
    onError?: (e: Error) => any

    constructor(timeMs: number, name?: string) {
        this.time = timeMs
        if (name) {
            this.name = name
            Debounce.named[name] = this
        }
    }

    run(func: () => any) {
        this.func = func
        if (this.timer) {
            try {
                clearTimeout(this.timer)
            } catch (e) {}
        }
        this.timer = setTimeout(() => {
            try {
                this.func()
            } catch (e) {
                if (this.onError) {
                    this.onError(e)
                } else {
                    log.error(e)
                }
            }
            if (this.name && Debounce.named[this.name]) {
                delete Debounce.named[this.name]
            }
        }, this.time)
    }
}

export function debounce(ms: number, name?: string) {
    if (name && Debounce.named[name]) {
        const dbc = Debounce.named[name]
        dbc.time = ms
        return dbc
    }
    const dbc = name ? new Debounce(ms, name) : new Debounce(ms)
    return dbc
}
