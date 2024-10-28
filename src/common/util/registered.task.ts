import { punchGrab } from '../../type-transform'
import { globalRoot } from '../env/env.profile'
import { Entity } from '../ix.entity'

export class Task {
    id: string
    name: string
    context: string
    type: 'task' | 'background-task'
    source: Error
    logic: (task: Task) => any
    count?: number
    timeCreated?: number
    timeDeregistered?: number
    lastRun?: number
    runCountMax?: number
    interval?: number
}

class GlobalTaskHandle {
    static counter = 0
    static foreground: { [jobId: string]: Task } = {}
    static background: { [jobId: string]: Task } = {}
    static taskDefaultTickInterval = 33
    static checker: any
    static errors: Error[] = []
    static addForeground(
        nameOrEntity: Entity | string,
        context?: string,
        logic?: (task: Task) => any,
        interval = 0,
        runCountMax = -1,
    ) {
        let nameVal =
            typeof nameOrEntity === 'string' ? nameOrEntity : nameOrEntity.ix.id
        if (!nameVal) {
            nameVal = '(unknown)'
        }
        if (!context) {
            context = '(unknown)'
        }
        const id = `task_${GlobalTaskHandle.counter++}`
        const task: Task = (GlobalTaskHandle.foreground[id] = {
            id,
            name: nameVal,
            context,
            type: 'task',
            source: new Error('GlobalTaskHandle Source Trace'),
            logic,
            interval,
            lastRun: 0,
            count: 0,
            runCountMax,
            timeCreated: Date.now(),
        })
        GlobalTaskHandle.enableTaskProcessor()
        if (typeof nameOrEntity !== 'string') {
            nameOrEntity.addOnDestroy(() => GlobalTaskHandle.deregister(task))
        }
        return task
    }
    static addBackground(
        nameOrEntity: Entity | string,
        context?: string,
        logic?: (task: Task) => any,
        interval = 0,
        runCountMax = -1,
    ) {
        let nameVal =
            typeof nameOrEntity === 'string' ? nameOrEntity : nameOrEntity.ix.id
        if (!nameVal) {
            nameVal = '(unknown)'
        }
        if (!context) {
            context = '(unknown)'
        }
        const id = `task_${GlobalTaskHandle.counter++}`
        const task: Task = (GlobalTaskHandle.background[id] = {
            id,
            name: nameVal,
            context,
            type: 'background-task',
            source: new Error('GlobalTaskHandle Source Trace'),
            logic,
            interval,
            lastRun: 0,
            count: 0,
            runCountMax,
            timeCreated: Date.now(),
        })
        if (typeof nameOrEntity !== 'string') {
            nameOrEntity.addOnDestroy(() => GlobalTaskHandle.deregister(task))
        }
        return task
    }
    static enableTaskProcessor() {
        if (GlobalTaskHandle.checker) {
            return
        }
        GlobalTaskHandle.checker = setInterval(() => {
            const now = Date.now()
            for (const taskId of Object.keys(GlobalTaskHandle.foreground)) {
                const task = GlobalTaskHandle.foreground[taskId]
                if (task.interval === 0 && task.lastRun === 0) {
                    ++task.count
                    task.lastRun = now
                    try {
                        task.logic(task)
                    } catch (e) {
                        GlobalTaskHandle.errors.push(e)
                    }
                    GlobalTaskHandle.deregister(task)
                } else if (
                    task.interval &&
                    now - task.lastRun > task.interval
                ) {
                    ++task.count
                    task.lastRun = now
                    try {
                        task.logic(task)
                    } catch (e) {
                        GlobalTaskHandle.errors.push(e)
                    }
                }
                if (task.runCountMax !== -1 && task.count >= task.runCountMax) {
                    GlobalTaskHandle.deregister(task)
                }
            }
            for (const taskId of Object.keys(GlobalTaskHandle.background)) {
                const task = GlobalTaskHandle.background[taskId]
                if (task.interval === 0 && task.lastRun === 0) {
                    ++task.count
                    task.lastRun = now
                    try {
                        task.logic(task)
                    } catch (e) {
                        GlobalTaskHandle.errors.push(e)
                    }
                    GlobalTaskHandle.deregister(task)
                } else if (
                    task.interval &&
                    now - task.lastRun > task.interval
                ) {
                    ++task.count
                    task.lastRun = now
                    try {
                        task.logic(task)
                    } catch (e) {
                        GlobalTaskHandle.errors.push(e)
                    }
                }
                if (task.runCountMax !== -1 && task.count >= task.runCountMax) {
                    GlobalTaskHandle.deregister(task)
                }
            }
        }, GlobalTaskHandle.taskDefaultTickInterval)
    }
    static deregister(task: Task) {
        if (!task || !task.id || task.timeDeregistered) {
            return
        }
        if (task.type === 'task') {
            if (GlobalTaskHandle.foreground[task.id]) {
                delete GlobalTaskHandle.foreground[task.id]
                task.timeDeregistered = Date.now()
            }
            if (
                GlobalTaskHandle.checker &&
                Object.keys(GlobalTaskHandle.foreground).length === 0
            ) {
                clearInterval(GlobalTaskHandle.checker)
            }
        } else {
            if (GlobalTaskHandle.background[task.id]) {
                delete GlobalTaskHandle.background[task.id]
                task.timeDeregistered = Date.now()
            }
        }
    }
    static async main(logic?: Function) {
        if (!logic) {
            logic = () => new Promise(() => {})
        } // forever hang
        const main = GlobalTaskHandle.addForeground(
            'main',
            'main-function',
            () => {},
            1000,
        )
        await punchGrab(logic())
        GlobalTaskHandle.deregister(main)
    }
}

if (!globalRoot.taskHandler) {
    globalRoot.taskHandler = GlobalTaskHandle
}

export const Tasks = new Proxy(
    globalRoot.taskHandler as typeof GlobalTaskHandle,
    {},
)
