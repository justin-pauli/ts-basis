/* Justin Pauli (c) 2020, License: MIT */

import {
    Subject,
    Observable,
    BehaviorSubject,
    Observer,
    Subscription,
} from 'rxjs'
import { PromUtil } from './util/prom.util'
import { autoUnsub } from '../angular.helper'
import { envVar } from './env/env.profile'

const commonEntityIdData = { index: 0 }
const commonEntityIdGeneration = {
    type: 'default',
    generator: (entityType?: string) => {
        const idx = (commonEntityIdData.index++).toString(36)
        return `${entityType}-${idx}`
    },
    changeHistory: [] as Error[],
}

export class Event<T = any> {
    name: string
    entity: Entity
    appliesTo: { [ixId: string]: Entity } = {}
    scope: MajorScope
    data: T
    constructor(name: string, data?: any, entity?: Entity) {
        this.name = name
        this.data = data
        if (entity) {
            this.entity = entity
            this.scope = entity.ix.majorScope
        }
    }
}
const eventSubject = new Subject<Event>()
export function eventCast(
    evtName: string,
    evtData: any,
    sourceEntity?: Entity,
) {
    const e = new Event(evtName, evtData, sourceEntity)
    if (!e.appliesTo) {
        e.appliesTo = {}
    }
    if (sourceEntity) {
        e.appliesTo[sourceEntity.ix.id] = sourceEntity
    }
    eventSubject.next(e)
}
export const event$ = eventSubject.asObservable()

const errorSubject = new Subject<ScopedError>()
export class ScopedError extends Error {
    meta?: any
    entity?: Entity
    appliesTo?: { [ixId: string]: Entity } = {}
    scope?: MajorScope
    severity?: number
    constructor(message: string) {
        super(message)
    }
}
export function enscope(e: Error, sourceEntity: Entity) {
    if (sourceEntity && sourceEntity.ix.majorScope) {
        ;(e as any).entity = sourceEntity
        ;(e as any).scope = sourceEntity.ix.majorScope
    }
    return e as ScopedError
}
export function errorCast(e: ScopedError, sourceEntity?: Entity) {
    e = enscope(e, sourceEntity)
    errorSubject.next(e)
}
export const error$ = errorSubject.asObservable()

export class LinkedSubscription extends Subscription {
    static counter = 0
    static registry: { [id: string]: LinkedSubscription } = {}
    id: string
    name: string
    entity: Entity
    source?: Error
    link(entity: Entity) {
        return this
    }
}

export class LinkedObservable<T = any> extends Observable<T> {
    static traceSubscriptions = envVar('TSB_TRACE', false)
    static fromLinkedSubject<T = any>(subj: Subject<T> | BehaviorSubject<T>) {
        const obs = subj.asObservable()
        const entity = (subj as any).__rx_data_source_entity
        const evtName = (subj as any).__rx_name
        ;(obs as LinkedObservable<T>).subject = subj
        ;(obs as LinkedObservable<T>).dataSourceEntity = entity
        const rxOpts: RxOptions = (subj as any).__rx_opts
        Object.defineProperty(obs, 'subscribe2', { value: obs.subscribe })
        Object.defineProperty(obs, '__rx_name', { value: evtName })
        let firstTime = true
        ;(obs as any).subscribe = (
            listener: ((value: T) => any) | Partial<Observer<T>>,
        ) => {
            if (rxOpts?.onNewSubscriber) {
                rxOpts.onNewSubscriber(new Error(), entity)
            }
            const subscribeEvent = { name: evtName, firstTime }
            firstTime = false
            const subs: LinkedSubscription = (obs as any).subscribe2(listener)
            Object.defineProperty(subs, 'unsubscribe2', {
                value: subs.unsubscribe,
            })
            subs.id = `subs_${LinkedSubscription.counter++}`
            subs.name = evtName
            subs.link = (entity: Entity) => {
                if (!entity || subs.entity) {
                    return
                }
                subs.entity = entity
                if (!entity['__rx_subs']) {
                    entity['__rx_subs'] = []
                }
                entity['__rx_subs'].push(subs)
                return subs
            }
            subs.unsubscribe = () => {
                if (subs.closed) {
                    return
                }
                delete LinkedSubscription.registry[subs.id]
                ;(subs as any).unsubscribe2()
            }
            LinkedSubscription.registry[subs.id] = subs
            if (LinkedObservable.traceSubscriptions) {
                subs.source = new Error('Subscription Source Trace')
            }
            entity?.ix?.pushEvent('ix-subscribed', subscribeEvent)
            return subs
        }
        ;(obs as any).next = (
            nextValue: T,
            errorHandler?: (e: Error) => any,
        ) => {
            try {
                subj.next(nextValue)
            } catch (e) {
                try {
                    if (errorHandler) {
                        errorHandler(e)
                    }
                } catch (e2) {}
            }
        }
        return obs as LinkedObservable<T>
    }
    constructor() {
        super()
    }
    subject: Subject<T> | BehaviorSubject<T>
    dataSourceEntity: Entity
    subscribe(
        observerOrNext?: Partial<Observer<T>> | ((value: T) => void),
    ): LinkedSubscription
    subscribe(
        next?: (value: T) => void,
        error?: (error: any) => void,
        complete?: () => void,
    ): LinkedSubscription
    subscribe(
        next?: unknown,
        error?: unknown,
        complete?: unknown,
    ): LinkedSubscription {
        return null as LinkedSubscription
    }
    next(nextValue: T, errorHandler?: (e: Error) => any) {}
}

export interface RxInfo<T = any> {
    name: string
    data: { [key: string]: any }
    subject: Subject<T>
    observable: LinkedObservable<T>
    oninits: (() => any)[]
    init: () => any
    obs: () => LinkedObservable<T>
    next: (v: T) => any
}

export interface RxOptions {
    trackSubscribers?: boolean
    onNewSubscriber?: <T>(e: Error, subber?: Entity) => any
    findNameFromThisObservable?: Observable<any> | LinkedObservable<any>
}

export interface IxData {
    id: string
    parent?: Entity
    majorScope?: MajorScope
    childrenMap: { [childIxId: string]: Entity }
    registries: { [registryId: string]: Registry<Entity> }
    rxObjects: { [type: string]: RxInfo }
    onDestroys: ((self: Entity) => any)[]
    destroyed: boolean
    self: Entity
    registerOn: (registry: Registry<Entity>) => Entity
    setEntityId: (id: string, addSuffix?: boolean) => Entity
    pushError: (
        e: Error | string,
        severity?: number,
        metadata?: { [key: string]: any },
    ) => Entity
    pushEvent: (evtName: string, evtData: any) => Entity
    listen: <T = any>(
        obs: LinkedObservable<T>,
        listener: ((value: T) => any) | Partial<Observer<T>>,
    ) => Entity
    base: string
    any$: LinkedObservable<any>
    error$: LinkedObservable<ScopedError>
    event$: LinkedObservable<Event>
    subscribed$: LinkedObservable<Event<{ name: string; firstTime: boolean }>>
}

export class Entity<ExtensionType extends object = {}> {
    static idGenType() {
        return commonEntityIdGeneration.type
    }
    static idGenChangeHistory() {
        return commonEntityIdGeneration.changeHistory.slice(0)
    }
    static idGenCustom(
        type: string,
        generator: (entityType?: string) => string,
    ) {
        commonEntityIdGeneration.type = type
        commonEntityIdGeneration.generator = generator
        commonEntityIdGeneration.changeHistory.push(new Error())
    }
    ix = {
        id: null,
        parent: null,
        majorScope: null,
        childrenMap: {},
        registries: {},
        rxObjects: {},
        onDestroys: [],
        destroyed: false,
        registerOn: (registry: Registry<Entity>) => {
            registry.register(this)
            return this
        },
        setEntityId: (id: string, addSuffix = false) => {
            if (addSuffix) {
                id = commonEntityIdGeneration.generator(id)
            }
            if (id === this.ix.id) {
                return this
            }
            const oldId = this.ix.id
            const registries: { t: number; registry: Registry<Entity> }[] = []
            for (const regId of Object.keys(this.ix.registries)) {
                const registry = this.ix.registries[regId]
                const t = registry.registrationTime(this)
                registries.push({ registry, t })
                registry.deregister(this)
            }
            this.ix.id = id
            if (this.ix.parent?.ix.childrenMap[oldId]) {
                delete this.ix.parent.ix.childrenMap[oldId]
                this.ix.parent.ix.childrenMap[id] = this
            }
            for (const regInfo of registries) {
                regInfo.registry.register(this, regInfo.t)
            }
            return this
        },
        pushError: (
            e: Error | string,
            severity?: number,
            metadata?: { [key: string]: any },
        ) => {
            if (typeof e === 'string') {
                e = new Error(e)
            }
            const se = enscope(e, this)
            if (!severity) {
                severity = 1
            }
            if (metadata) {
                se.meta = metadata
            }
            se.severity = severity
            if (!se.appliesTo) {
                se.appliesTo = {}
            }
            se.appliesTo[this.ix.id] = this
            errorCast(se)
            return this
        },
        pushEvent: (evtName: string, evtData: any) => {
            eventCast(evtName, evtData, this)
            return this
        },
        listen: <T = any>(
            obs: LinkedObservable<T>,
            listener: ((value: T) => any) | Partial<Observer<T>>,
        ) => {
            Object.defineProperty(listener, '__rx_data_source_entity', {
                value: this,
            })
            const subs =
                typeof listener === 'function'
                    ? obs.subscribe(listener)
                    : obs.subscribe(listener)
            this.addOnDestroy(() => {
                subs.unsubscribe()
            })
            return this
        },
        self: this,
        get base() {
            return this.self.ix.majorScope
                ? this.self.ix.majorScope.name
                : `unknown`
        },
        get error$() {
            const rxObj = this.self.rx('error')
            if (!rxObj.subject) {
                rxObj.init()
            }
            if (!rxObj.data.init) {
                rxObj.data.init = true
                // tslint:disable-next-line: deprecation
                const gSub = error$.subscribe(e => {
                    if (
                        e.entity === this.self ||
                        (e.appliesTo && e.appliesTo[this.self.ix.id])
                    ) {
                        rxObj.next(e)
                    }
                })
                this.self.addOnDestroy(() => {
                    gSub.unsubscribe()
                })
            }
            return rxObj.observable as LinkedObservable<ScopedError>
        },
        get event$() {
            const rxObj = this.self.rx('event')
            if (!rxObj.subject) {
                rxObj.init()
            }
            if (!rxObj.data.init) {
                rxObj.data.init = true
                // tslint:disable-next-line: deprecation
                const gSub = event$.subscribe(e => {
                    if (
                        e.entity === this.self ||
                        (e.appliesTo && e.appliesTo[this.self.ix.id])
                    ) {
                        rxObj.next(e)
                    }
                })
                this.self.addOnDestroy(() => {
                    gSub.unsubscribe()
                })
            }
            return rxObj.observable as LinkedObservable<Event>
        },
        get any$() {
            const rxObj = this.self.rx('__any')
            if (!rxObj.subject) {
                rxObj.init()
            }
            return rxObj.observable as LinkedObservable<any>
        },
        get subscribed$() {
            const rxObj = this.self.rx('ix-subscribed')
            if (!rxObj.subject) {
                rxObj.init()
            }
            if (!rxObj.data.init) {
                rxObj.data.init = true
                // tslint:disable-next-line: deprecation
                const gSub = event$.subscribe(e => {
                    if (
                        e.entity === this.self ||
                        (e.appliesTo && e.appliesTo[this.self.ix.id])
                    ) {
                        if (e.name === 'ix-subscribed') {
                            rxObj.next(e)
                        }
                    }
                })
                this.self.addOnDestroy(() => {
                    gSub.unsubscribe()
                })
            }
            return rxObj.observable as LinkedObservable<
                Event<{ name: string; firstTime: boolean }>
            >
        },
    } as IxData & ExtensionType
    lifecycle = {
        managedBy: (parent: Entity) => {
            if (!parent) {
                return this
            }
            this.lifecycle.detach(true)
            parent.ix.childrenMap[this.ix.id] = this
            this.ix.parent = parent
            this.lifecycle.setMajorScope(parent.ix.majorScope)
            return this
        },
        manage: (child: Entity) => {
            if (!child) {
                return this
            }
            child.lifecycle.detach(true)
            this.ix.childrenMap[child.ix.id] = child
            child.ix.parent = this
            child.lifecycle.setMajorScope(this.ix.majorScope)
            return this
        },
        detach: (skipRootDetach: boolean = false) => {
            if (this.ix.parent) {
                delete this.ix.parent.ix.childrenMap[this.ix.id]
                this.ix.parent = null
                if (!skipRootDetach) {
                    this.lifecycle.setMajorScope(null)
                }
            }
        },
        setMajorScope: (
            rootScope: MajorScope,
            alsoUpdateChildren: boolean = true,
        ) => {
            this.ix.majorScope = rootScope
            if (alsoUpdateChildren) {
                for (const childId of Object.keys(this.ix.childrenMap)) {
                    const child = this.ix.childrenMap[childId]
                    if (child) {
                        child.lifecycle.setMajorScope(rootScope)
                    }
                }
            }
            return this
        },
    }
    constructor(entityType: string, ixIdOverride?: string) {
        this.ix.id = ixIdOverride
            ? ixIdOverride
            : commonEntityIdGeneration.generator(entityType)
    }
    get destroyed() {
        return this.ix?.destroyed
    }
    addOnDestroy(ondestroy: (self: Entity) => any) {
        this.ix.onDestroys.push(ondestroy)
        return this
    }
    destroy() {
        if (this.ix.destroyed) {
            return Promise.resolve(null)
        }
        try {
            autoUnsub(this)
        } catch (e) {}
        this.ix.destroyed = true
        const subDestroyProms = []
        if (this.ix.onDestroys) {
            for (const ixOnDestroy of this.ix.onDestroys) {
                if (ixOnDestroy) {
                    try {
                        const v = ixOnDestroy(this)
                        if (v && v.then) {
                            subDestroyProms.push(v)
                        }
                    } catch (e) {
                        errorCast(e)
                    }
                }
            }
        }
        for (const regId of Object.keys(this.ix.registries)) {
            this.ix.registries[regId].deregister(this)
        }
        for (const childId of Object.keys(this.ix.childrenMap)) {
            const child = this.ix.childrenMap[childId]
            if (child) {
                subDestroyProms.push(child.destroy())
            }
        }
        this.lifecycle.detach()
        for (const rxName of Object.keys(this.ix.rxObjects)) {
            const rxReg = this.ix.rxObjects[rxName]
            rxReg.subject?.complete()
        }
        this.ix.rxObjects = null
        this.ix.majorScope = null
        this.ix.childrenMap = null
        this.ix = null
        return PromUtil.allSettled(subDestroyProms)
    }
    rx<T = any>(rxName: string, rcOpts?: RxOptions) {
        if (
            rcOpts?.findNameFromThisObservable &&
            (rcOpts.findNameFromThisObservable as any).__rx_name
        ) {
            rxName = (rcOpts.findNameFromThisObservable as any).__rx_name
        }
        if (!rxName) {
            return null
        }
        let rxObj = this.ix.rxObjects[rxName]
        if (!rxObj) {
            rxObj = this.ix.rxObjects[rxName] = {
                name: rxName,
                data: {},
                subject: null,
                observable: null,
                oninits: [],
                init: () => {
                    if (rxObj.subject) {
                        return
                    }
                    rxObj.subject = new Subject<T>()
                    Object.defineProperty(
                        rxObj.subject,
                        '__rx_data_source_entity',
                        { value: this },
                    )
                    Object.defineProperty(rxObj.subject, '__rx_opts', {
                        value: rcOpts,
                    })
                    Object.defineProperty(rxObj.subject, '__rx_name', {
                        value: rxName,
                    })
                    rxObj.observable = LinkedObservable.fromLinkedSubject(
                        rxObj.subject,
                    )
                    for (const oninit of rxObj.oninits) {
                        oninit()
                    }
                },
                obs: () => {
                    if (!rxObj.subject) {
                        rxObj.init()
                    }
                    return rxObj.observable
                },
                next: v => {
                    if (!rxObj.subject) {
                        rxObj.init()
                    }
                    if (rxName !== '__any') {
                        const genericSelfRx = this.rx('__any')
                        if (!genericSelfRx.subject) {
                            genericSelfRx.init()
                        }
                        genericSelfRx.next(v)
                    }
                    if (rxObj.subject) {
                        rxObj.subject.next(v)
                    }
                },
            }
        }
        return rxObj as RxInfo<T>
    }
}

export class Registry<T extends Entity> extends Entity {
    private data: { [id: string]: { target: T; t: number } } = {}
    constructor() {
        super('registry')
    }
    get(ixId: string) {
        return this.data[ixId].target
    }
    has(entity: T) {
        return this.data[entity.ix.id] ? true : false
    }
    exists(entity: T) {
        return this.data[entity.ix.id] ? true : false
    }
    register(entity: T, overrideTime?: number) {
        const entityIxId = entity.ix.id
        if (this.data[entityIxId]) {
            return this
        }
        this.data[entityIxId] = {
            target: entity,
            t: overrideTime ? overrideTime : Date.now(),
        }
        entity.ix.registries[this.ix.id] = this
        return this
    }
    deregister(entity: T) {
        const reg = this.data[entity.ix.id]
        if (reg) {
            delete reg.target.ix.registries[this.ix.id]
            delete this.data[entity.ix.id]
        }
        return this
    }
    registrationTime(entity: T) {
        const reg = this.data[entity.ix.id]
        return reg ? reg.t : null
    }
}

export class Scope extends Entity {
    name: string
    isMajorScope: boolean
    executeWithinScope: (scope: Scope) => any
    constructor(
        name: string,
        executeWithinScope?: (scope: Scope) => any,
        isMajorScope?: boolean,
    ) {
        super(isMajorScope ? 'major-scope' : 'scope', null)
        this.name = name
        this.isMajorScope = !!isMajorScope
        if (!this.name) {
            this.name = isMajorScope
                ? `(major-scope-${this.ix.id})`
                : `(scope-${this.ix.id})`
        }
        this.executeWithinScope = executeWithinScope
        if (this.executeWithinScope) {
            this.executeWithinScope(this)
        }
    }
}

export class MajorScope extends Scope {
    constructor(name: string, executeWithinScope?: (scope: Scope) => any) {
        super(name, executeWithinScope, true)
        this.lifecycle.setMajorScope(this)
        this.rx('error').oninits.push(() => {
            // tslint:disable-next-line: deprecation
            const scopedErrorSubs = error$.subscribe(e => {
                if (e.scope === this) {
                    this.rx('error').next(e)
                }
            })
            this.addOnDestroy(() => {
                scopedErrorSubs.unsubscribe()
            })
        })
        this.rx('event').oninits.push(() => {
            // tslint:disable-next-line: deprecation
            const scopedEventSubs = event$.subscribe(e => {
                if (e.scope === this) {
                    this.rx('event').next(e)
                }
            })
            this.addOnDestroy(() => {
                scopedEventSubs.unsubscribe()
            })
        })
    }
}
