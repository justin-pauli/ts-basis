import { PromUtil } from '../../src'
import { globalRoot } from '../../src/common/env/env.profile'

export type ProcessExitType =
    | `exit`
    | `SIGINT`
    | `SIGUSR1`
    | `SIGUSR2`
    | `uncaughtException`
    | `SIGTERM`
    | `graceful`
class ProcessExitHandler {
    allExitEvents = [
        `exit`,
        `SIGINT`,
        `SIGUSR1`,
        `SIGUSR2`,
        `uncaughtException`,
        `SIGTERM`,
    ] as ProcessExitType[]
    handlers = [] as {
        handler: (eventType: ProcessExitType) => any
        source: Error
    }[]
    exiting = false
    gracefulExitPromises = [] as Promise<any>[]
    defaultGracePeriod = 7000
    addEndingTask(taskPromise: Promise<any>) {
        this.gracefulExitPromises.push(taskPromise)
    }
    gracefully(
        exitCode: number = 0,
        gracePeriod: number = this.defaultGracePeriod,
        lastCallback?: () => any,
    ) {
        if (!gracePeriod) {
            gracePeriod = this.defaultGracePeriod
        }
        if (this.exiting) {
            return false
        }
        this.exiting = true
        for (const handlerData of this.handlers) {
            try {
                handlerData.handler(`graceful`)
            } catch (e) {
                console.error(e)
            }
        }
        PromUtil.allSettled(this.gracefulExitPromises).finally(() => {
            if (lastCallback) {
                lastCallback()
            }
            setTimeout(() => {
                process.exit(exitCode)
            }, 100)
        })
        setTimeout(() => {
            if (lastCallback) {
                lastCallback()
            }
            setTimeout(() => {
                process.exit(exitCode)
            }, 100)
        }, gracePeriod)
        return true
    }
    addHandler(handler: (eventType: ProcessExitType) => any) {
        this.handlers.push({ handler, source: new Error() })
        this.allExitEvents.forEach(eventType => {
            const bound = handler.bind(null, eventType)
            process.on(eventType, () => {
                try {
                    bound()
                } catch (e) {
                    console.error(e)
                }
            })
        })
    }
}

const processExitHandler = new ProcessExitHandler()

if (!globalRoot.ProcessExitHandler) {
    globalRoot.ProcessExitHandler = processExitHandler
}

export const ProcessExit = new Proxy(
    globalRoot.ProcessExitHandler as ProcessExitHandler,
    {},
)
