import { isNodeJs } from '../util/env.util'

declare let window: any
declare let process: any

export const globalRoot = isNodeJs ? process : window
export const __root = isNodeJs ? process : window

const applicationTarget = {
    PROFILE:
        isNodeJs && process.env.APPLICATION_PROFILE
            ? process.env.APPLICATION_PROFILE
            : 'test',
}
if (!globalRoot.APP) {
    globalRoot.APP = applicationTarget
}
if (!globalRoot.env) {
    globalRoot.env = {}
}

export const APP = new Proxy(globalRoot.APP as typeof applicationTarget, {})

export function setApplicationProfile(newProfile: string) {
    globalRoot.APP.PROFILE = newProfile
}

export function getApplicationProfile() {
    return globalRoot.APP.PROFILE
}

export function envVar<T = string>(envVar: string, defaultValue?: T): T {
    const env = globalRoot.env
    if (defaultValue === null || defaultValue === undefined) {
        return env[envVar] ? (env[envVar] as unknown as T) : defaultValue
    }
    if (typeof defaultValue === 'number') {
        return env[envVar]
            ? (parseInt(env[envVar], 10) as unknown as T)
            : defaultValue
    }
    if (typeof defaultValue === 'boolean') {
        return env[envVar]
            ? ((['true', 'yes', '1', 'on', 'enable', 'enabled'].indexOf(
                  env[envVar].toLocaleLowerCase(),
              ) >= 0) as unknown as T)
            : defaultValue
    } else if (typeof defaultValue === 'object') {
        return env[envVar]
            ? (JSON.parse(env[envVar]) as unknown as T)
            : defaultValue
    }
    return env[envVar] ? (env[envVar] as unknown as T) : defaultValue
}
