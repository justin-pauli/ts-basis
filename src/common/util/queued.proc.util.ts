import { promise, Promise2 } from './prom.util'

type PendingProc<T = any> = {
    proc: Promise2<any>
    resolve: (ret: QueuedProcResult<T>) => any
    asyncLogic: () => Promise<T>
}
const queuedProcs: {
    [name: string]: {
        checker: any
        running: boolean
        queue: PendingProc[]
    }
} = {}

type QueueProcessOption = {
    name: string
    maxQueueLength?: number
}

type QueuedProcGoodResult<T = any> = {
    status: 'ok'
    result: T
}
type QueuedProcBadResult = {
    status: 'error'
    message: string
}
type QueuedProcResult<T = any> = QueuedProcGoodResult<T> | QueuedProcBadResult

export function runInQueue<T = any>(
    options: QueueProcessOption,
    asyncLogic: () => Promise<T>,
) {
    const { name, maxQueueLength = 0 } = options

    if (!queuedProcs[name]) {
        queuedProcs[name] = {
            checker: null,
            running: false,
            queue: [],
        }
    }

    if (!queuedProcs[name].checker) {
        queuedProcs[name].checker = setInterval(async () => {
            if (queuedProcs[name].running) {
                return
            }
            queuedProcs[name].running = true
            const currentSlice = [...queuedProcs[name].queue]
            queuedProcs[name].queue = []
            for (const procData of currentSlice) {
                let result: any = undefined
                try {
                    result = await procData.asyncLogic()
                    procData.resolve({
                        status: 'ok',
                        result,
                    })
                } catch (e) {
                    procData.resolve({
                        status: 'error',
                        message: e.message,
                    })
                }
            }
            if (queuedProcs[name].queue.length === 0) {
                clearInterval(queuedProcs[name].checker)
                delete queuedProcs[name]
            }
            if (queuedProcs[name]) {
                queuedProcs[name].running = false
            }
        })
    }

    if (
        maxQueueLength &&
        maxQueueLength >= 1 &&
        queuedProcs[name].queue.length >= maxQueueLength
    ) {
        return promise<QueuedProcResult<T>>(resolve =>
            resolve({
                status: 'error',
                message: `Max queue ${maxQueueLength} exceeded for queue '${name}'`,
            }),
        )
    }
    let resolver: any = null
    const proc = promise<QueuedProcResult<T>>(resolve => {
        resolver = resolve
    })
    queuedProcs[name].queue.push({
        proc,
        resolve: resolver,
        asyncLogic,
    })
    return proc
}
