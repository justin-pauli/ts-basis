/*
 * Copyright 2014-2021 Justin Pauli, all rights reserved.
 */

import { Class } from '../../type-transform'
import { Entity } from '../ix.entity'

export interface LoggerOptions {
    mode: 'string' | 'json'
    timeFormat: 'iso' | 'local'
}

export class Logger {
    private static defaultLogger: Logger = null
    static setDefaultLogger(logger: Logger) {
        Logger.defaultLogger = logger
    }
    static getDefaultLogger() {
        if (!Logger.defaultLogger) {
            return log
        }
        return Logger.defaultLogger
    }

    _entity: Entity
    options: LoggerOptions
    debug3(...args: any[]) {
        // tslint:disable-next-line: no-console
        console.debug(
            `[${new Date().toISOString()}] DBG_3 [${this._entity.ix.id}]`,
            ...args,
        )
    }
    debug2(...args: any[]) {
        // tslint:disable-next-line: no-console
        console.debug(
            `[${new Date().toISOString()}] DBG_2 [${this._entity.ix.id}]`,
            ...args,
        )
    }
    debug(...args: any[]) {
        // tslint:disable-next-line: no-console
        console.debug(
            `[${new Date().toISOString()}] DBG_1 [${this._entity.ix.id}]`,
            ...args,
        )
    }
    info(...args: any[]) {
        // tslint:disable-next-line: no-console
        console.info(
            `[${new Date().toISOString()}] INFO  [${this._entity.ix.id}]`,
            ...args,
        )
    }
    warn(...args: any[]) {
        // tslint:disable-next-line: no-console
        console.warn(
            `[${new Date().toISOString()}] WARN  [${this._entity.ix.id}]`,
            ...args,
        )
    }
    error(...args: any[]) {
        // tslint:disable-next-line: no-console
        console.error(
            `[${new Date().toISOString()}] ERROR [${this._entity.ix.id}]`,
            ...args,
        )
    }
    fatal(...args: any[]) {
        // tslint:disable-next-line: no-console
        console.error(
            `[${new Date().toISOString()}] FATAL [${this._entity.ix.id}]`,
            ...args,
        )
    }

    constructor(entity?: Entity, options?: LoggerOptions) {
        if (!entity) {
            entity = new Entity('defaultlogger')
        }
        this._entity = entity
        if (options) {
            this.options = options
        }
        if (!this.options) {
            this.options = {
                mode: 'string',
                timeFormat: 'iso',
            }
        }
        if (!this.options.mode) {
            this.options.mode = 'string'
        }
        if (!this.options.timeFormat) {
            this.options.timeFormat = 'iso'
        }
    }
}

class Logger2 {
    static _entity: Entity
    static options: LoggerOptions
    static debug3(...args: any[]) {
        args
    }
    static debug2(...args: any[]) {
        args
    }
    static debug(...args: any[]) {
        args
    }
    static info(...args: any[]) {
        args
    }
    static warn(...args: any[]) {
        args
    }
    static error(...args: any[]) {
        args
    }
    static fatal(...args: any[]) {
        args
    }
}

export class PassthruLogger {
    info(...args) {
        // tslint:disable-next-line: no-console
        console['log'](...args)
    }
    debug(...args) {
        // tslint:disable-next-line: no-console
        console.debug(...args)
    }
    error(...args) {
        // tslint:disable-next-line: no-console
        console.error(...args)
    }
}

export const log = new Proxy(
    {},
    {
        get: (t, p, r) => {
            return getDefaultLogger()[p]
        },
    },
) as typeof Logger2

export function getDefaultLogger() {
    return Logger.getDefaultLogger()
}

export function setDefaultLogger(logger: Logger) {
    return Logger.setDefaultLogger(logger)
}
