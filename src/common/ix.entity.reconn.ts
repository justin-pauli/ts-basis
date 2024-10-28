/* Justin Pauli (c) 2020, License: MIT */

import { Observable, Subscription } from 'rxjs'
import { ConfigSource } from './ix.config.source'
import { Entity, LinkedObservable } from './ix.entity'
import { HalfLifed } from './ix.halflifed'
import { timerInterval, Timer } from './ix.timer'

export class ReconnEntityBehavior {
    static defaultProfile: ReconnEntityBehavior = null
    resetThreshold?: number = 5
    defunctThreshold?: number = 3
    errorHalfLife?: number = 300
    defunctHalfLife?: number = 3600
    restoreCheckInterval?: number = 60
    constructor(init?: Partial<ReconnEntityBehavior>) {
        if (init) {
            Object.assign(this, init)
        }
    }
}

interface ReconnData {
    config: ReconnEntityBehavior
    configSource: ConfigSource<ReconnEntityBehavior>
    configSubs: Subscription
    resetInProgress: Promise<void>
    error: Error
    errorLast: number
    errorHeat: HalfLifed
    defunctHeat: HalfLifed
    defunctState: boolean
    defunctRestoreCheckedLast: number
    defunctRestoreCheckInterval: number
    defunctRestoreChecker: Timer
    setRestoreFunction: (
        attempt: (self: ReconnEntity) => boolean | Promise<boolean>,
    ) => void
    setConfigSource: (src: ConfigSource<ReconnEntityBehavior>) => void
    actions: {
        reset: () => any
        attemptToRestore: (self: ReconnEntity) => boolean | Promise<boolean>
    }
    on: {
        reset: () => any
        defunct: () => any
        restore: () => any
    }
    event: {
        self: Entity
        get errorHeatUp$(): LinkedObservable<number>
        get defunctHeatUp$(): LinkedObservable<number>
        get errorDuringDefunct$(): LinkedObservable<Error>
        get beforeReset$(): LinkedObservable<ReconnEntity>
        get reset$(): LinkedObservable<ReconnEntity>
        get beforeDefunct$(): LinkedObservable<ReconnEntity>
        get defunct$(): LinkedObservable<ReconnEntity>
        get beforeRestore$(): LinkedObservable<ReconnEntity>
        get restore$(): LinkedObservable<ReconnEntity>
        get configChange$(): LinkedObservable<ReconnEntity>
    }
}

export class ReconnEntity extends Entity<{ reconn: ReconnData }> {
    constructor(entityType?: string, ixIdOverride?: string) {
        super(entityType, ixIdOverride)
        if (!ReconnEntityBehavior.defaultProfile) {
            ReconnEntityBehavior.defaultProfile = new ReconnEntityBehavior()
        }
        const dfProfile = ReconnEntityBehavior.defaultProfile
        this.ix.reconn = {
            config: {
                resetThreshold: 5,
                defunctThreshold: 3,
            } as ReconnEntityBehavior,
            configSource: null as ConfigSource<ReconnEntityBehavior>,
            configSubs: null as Subscription,
            resetInProgress: null as Promise<void>,
            error: null as Error,
            errorLast: 0,
            errorHeat: new HalfLifed({ hl: 300 }),
            defunctHeat: new HalfLifed({ hl: 3600 }),
            defunctState: false,
            defunctRestoreCheckedLast: 0,
            defunctRestoreCheckInterval: 60,
            defunctRestoreChecker: null as Timer,
            setRestoreFunction: (
                attempt: (self: ReconnEntity) => boolean | Promise<boolean>,
            ) => {
                this.ix.reconn.actions.attemptToRestore = attempt
            },
            setConfigSource: (src: ConfigSource<ReconnEntityBehavior>) => {
                if (this.ix.reconn.configSource === src) {
                    return
                }
                if (this.ix.reconn.configSubs) {
                    this.ix.reconn.configSubs.unsubscribe()
                }
                this.ix.reconn.configSource = src
                // tslint:disable-next-line: deprecation
                this.ix.reconn.configSubs = src.change$.subscribe(confData => {
                    const conf = new ReconnEntityBehavior(confData)
                    this.ix.reconn.config.resetThreshold = conf.resetThreshold
                    this.ix.reconn.config.defunctThreshold =
                        conf.defunctThreshold
                    this.ix.reconn.errorHeat.hl = conf.errorHalfLife
                    this.ix.reconn.defunctHeat.hl = conf.defunctHalfLife
                    this.ix.reconn.defunctRestoreCheckInterval =
                        conf.restoreCheckInterval
                    this.rx<ReconnEntity>('reconn:config_change').next(this)
                })
            },
            actions: {
                reset: null as () => any,
                attemptToRestore: null as (
                    self: ReconnEntity,
                ) => boolean | Promise<boolean>,
            },
            on: {
                reset: null as () => any,
                defunct: null as () => any,
                restore: null as () => any,
            },
            event: {
                self: this,
                get errorHeatUp$() {
                    return (this.self as ReconnEntity)
                        .rx<number>('reconn:error_heat_up')
                        .obs()
                },
                get defunctHeatUp$() {
                    return (this.self as ReconnEntity)
                        .rx<number>('reconn:defunct_heat_up')
                        .obs()
                },
                get errorDuringDefunct$() {
                    return (this.self as ReconnEntity)
                        .rx<Error>('reconn:error_during_defunct')
                        .obs()
                },
                get beforeReset$() {
                    return (this.self as ReconnEntity)
                        .rx<ReconnEntity>('reconn:before_reset')
                        .obs()
                },
                get reset$() {
                    return (this.self as ReconnEntity)
                        .rx<ReconnEntity>('reconn:reset')
                        .obs()
                },
                get beforeDefunct$() {
                    return (this.self as ReconnEntity)
                        .rx<ReconnEntity>('reconn:before_defunct')
                        .obs()
                },
                get defunct$() {
                    return (this.self as ReconnEntity)
                        .rx<ReconnEntity>('reconn:defunct')
                        .obs()
                },
                get beforeRestore$() {
                    return (this.self as ReconnEntity)
                        .rx<ReconnEntity>('reconn:before_restore')
                        .obs()
                },
                get restore$() {
                    return (this.self as ReconnEntity)
                        .rx<ReconnEntity>('reconn:restore')
                        .obs()
                },
                get configChange$() {
                    return (this.self as ReconnEntity)
                        .rx<ReconnEntity>('reconn:config_change')
                        .obs()
                },
            },
        }
        this.ix.reconn.config.resetThreshold = dfProfile.resetThreshold
        this.ix.reconn.config.defunctThreshold = dfProfile.defunctThreshold
        this.ix.reconn.errorHeat.hl = dfProfile.errorHalfLife
        this.ix.reconn.defunctHeat.hl = dfProfile.defunctHalfLife
        this.ix.reconn.defunctRestoreCheckInterval =
            dfProfile.restoreCheckInterval
        this.ix.reconn.errorHeat.afterUpdate.push(async (heat, v) => {
            if (this.ix.reconn.defunctState) {
                this.rx<Error>('reconn:error_during_defunct').next(
                    this.ix.reconn.error,
                )
                return
            }
            if (
                this.ix.reconn.errorHeat.value >
                this.ix.reconn.config.resetThreshold
            ) {
                this.ix.reconn.errorHeat.reset()
                this.ix.reconn.defunctHeat.add(1)
                this.rx<number>('reconn:defunct_heat_up').next(
                    this.ix.reconn.defunctHeat.value,
                )
                if (
                    this.ix.reconn.defunctHeat.value <
                    this.ix.reconn.config.defunctThreshold
                ) {
                    this.rx<ReconnEntity>('reconn:before_reset').next(this)
                    let resolver = null
                    this.ix.reconn.resetInProgress = new Promise<void>(
                        resolve => (resolver = resolve),
                    )
                    try {
                        await Promise.resolve(this.ix.reconn.actions.reset?.())
                    } catch (e) {
                        this.ix.pushError(e)
                    }
                    this.ix.reconn.resetInProgress = null
                    resolver?.()
                    this.ix.reconn.on.reset?.()
                    this.rx<ReconnEntity>('reconn:reset').next(this)
                } else {
                    this.ix.reconn.defunctHeat.reset()
                    this.ix.reconn.defunctState = true
                    this.ix.reconn.defunctRestoreCheckedLast = Date.now()
                    this.rx<ReconnEntity>('reconn:before_defunct').next(this)
                    this.ix.reconn.on.defunct?.()
                    this.rx<ReconnEntity>('reconn:defunct').next(this)
                }
            }
        })
        this.ix.reconn.defunctRestoreChecker = timerInterval(1000, async () => {
            if (!this.ix.reconn.defunctState) {
                return
            }
            if (
                Date.now() - this.ix.reconn.defunctRestoreCheckedLast >
                this.ix.reconn.defunctRestoreCheckInterval * 1000
            ) {
                this.ix.reconn.defunctRestoreCheckedLast = Date.now()
                if (this.ix.reconn.actions.attemptToRestore) {
                    const res = await Promise.resolve(
                        this.ix.reconn.actions.attemptToRestore(this),
                    )
                    if (res) {
                        this.ix.reconn.defunctState = false
                        this.rx<ReconnEntity>('reconn:before_restore').next(
                            this,
                        )
                        this.ix.reconn.errorHeat.reset()
                        this.ix.reconn.defunctHeat.reset()
                        this.ix.reconn.on.restore?.()
                        this.rx<ReconnEntity>('reconn:restore').next(this)
                    }
                }
            }
        })
        // tslint:disable-next-line: deprecation
        const eSub = this.ix.error$.subscribe(e => {
            const severity = e.severity ? e.severity : 1
            this.ix.reconn.errorLast = Date.now()
            this.ix.reconn.error = e
            this.ix.reconn.errorHeat.add(severity)
            this.rx<number>('reconn:error_heat_up').next(
                this.ix.reconn.errorHeat.value,
            )
        })
        this.ix.reconn.errorHeat.lifecycle.managedBy(this)
        this.ix.reconn.defunctHeat.lifecycle.managedBy(this)
        this.ix.reconn.defunctRestoreChecker.lifecycle.managedBy(this)
        this.addOnDestroy(() => {
            eSub.unsubscribe()
            if (this.ix.reconn.configSubs) {
                this.ix.reconn.configSubs.unsubscribe()
            }
        })
    }
}
