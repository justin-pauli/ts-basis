import zlib from 'zlib'
import WebSocket, { WebSocketServer } from 'ws'
import { Entity } from '../../src/common/ix.entity'
import { Logger } from '../../src/common/logger/logger'
import {
    BasicUserData,
    deepCopy,
    errorResult,
    ok,
    promise,
    Result,
    valueMap,
} from '../../src'
import { ClientRequestArgs, IncomingMessage } from 'http'
import { v4 as uuidv4 } from 'uuid'
import { randomBytes } from 'crypto'
import { createServer } from 'http'
import { Codec } from '../../src/common/util/encoding.util'

type WsMessageType =
    | 'json-action-invoke'
    | 'json-action-ack'
    | 'json-action-return'

type PendingMessage = {
    id: string
    type: WsMessageType
    compression?: string
    metadata?: string
    actionName?: string
    actionIid?: string
    started: number
    buffer: Buffer
    range: {
        start: number
        end: number
    }
}
type PendingMessageRegistry = {
    [id: string]: PendingMessage
}

type HeadersMap = { [headerName: string]: string }

type WsShimOptions = {
    pingInterval?: number
    maxPongWaitTime?: number
    maxBidirectionalAuthWaitTime?: number
    maxReconnectWaitTime?: number
    wsOptions?: WebSocket.ClientOptions & ClientRequestArgs
    wsHeaders?: HeadersMap | (() => Promise<HeadersMap>)
}

interface WsActionMetadata {
    name: string
    iid: string
}

interface WsActionData<T = any> {
    data?: T
}

type WsQueuedMessages = {
    [clientId: string]: {
        dataLength: number
        queue: {
            [msgId: string]: (string | Buffer)[]
        }
    }
}

type WsActionLogic<Input = any, Output = any> = (
    client: WebSocketClient,
    actionData: WsActionData<Input>,
    rolesApplicable: string[],
) => Promise<Result<Output>>
type WsActionAuthRubric =
    | string[]
    | ((
          client: WebSocketClient,
          actionData: WsActionData,
          rolesApplicable: string[],
      ) => Promise<Result<boolean>>)
type WsActionDefinition = {
    name: string
    authRubric?: WsActionAuthRubric
    logic: WsActionLogic
}

type WsActionInvocation = {
    source: WebSocketClient
    ack?: boolean
    ackDisabled?: boolean
    ackPromise?: Promise<any>
    ackResolver?: (ack: boolean) => any
    started?: number
    ended?: number
    action?: WsActionData
    returned?: boolean
    returnPromise?: Promise<any>
    returnResolver?: <T = any>(result: Result<T>) => any
    returnResult?: Result
}

type WsActionsRegistry = { [name: string]: WsActionDefinition }
type WsInvocationRegistry = { [fid: string]: WsActionInvocation }

type WsChunkedSendingOptions = {
    type?: WsMessageType
    iid?: string
    metadata?: string
    compression?: string
    sliceSize?: number
    chunkSendInterval?: number
    resendExpiry?: number
    maxOfflineDataHeapPerClient?: number
    maxOfflineDataDiskPerClient?: number
    timeout?: number
}

type WebSocketClient = WebSocket & {
    clientId?: string
    userdata?: {
        local?: BasicUserData
        remote?: BasicUserData
    }
    token?: string
    bidirectionalAuth?: boolean
}

const CLIENT_SELF_ID = '__client__'

export class WsBaseShim extends Entity {
    authHandler?: (
        client: WebSocketClient,
        req: IncomingMessage,
    ) => Promise<Result<BasicUserData>>
    authTokenProvider?: (
        client: WebSocketClient,
        req: IncomingMessage,
    ) => Promise<Result<string>>
    clients: { [id: string]: WebSocketClient } = {}
    queuedMessages: WsQueuedMessages
    pendingMessages: PendingMessageRegistry = {}
    actionsRegistry: WsActionsRegistry = {}
    invocationsRegistry: WsInvocationRegistry = {}
    logger: Logger
    options: WsShimOptions = {}

    constructor(entityType?: string) {
        super(entityType ?? 'wsshim')
    }

    registerAction<Input = any, Output = any>(
        name: string,
        authRubric: WsActionAuthRubric,
        logic: WsActionLogic<Input, Output>,
    ) {
        if (this.actionsRegistry[name]) {
            this.logger.error(
                `Cannot register action '${name}'; already registered`,
            )
            return
        }
        this.actionsRegistry[name] = {
            name,
            authRubric,
            logic,
        }
    }

    sendJsonAction<Input = any, Output = any>(
        actionName: string,
        data: Input,
        clientId = CLIENT_SELF_ID,
        ackDisabled = false,
    ) {
        const client = this.clients[clientId]
        if (!client) {
            if (clientId === CLIENT_SELF_ID) {
                return promise(resolve =>
                    resolve(new Error(`Connection not available`)),
                )
            } else {
                return promise(resolve =>
                    resolve(new Error(`Client id must be specified`)),
                )
            }
        }
        const iid = uuidv4()
        let returnResolver = null
        const returnPromise = promise(resolve => {
            returnResolver = resolve
        })
        if (ackDisabled) {
            this.invocationsRegistry[iid] = {
                source: client,
                ack: false,
                ackDisabled,
                returnResolver,
                returnPromise,
                started: Date.now(),
                action: {
                    data,
                },
            }
        } else {
            let ackResolver = null
            const ackPromise = promise(resolve => {
                ackResolver = resolve
            })
            this.invocationsRegistry[iid] = {
                source: client,
                ack: false,
                ackDisabled,
                ackPromise,
                ackResolver,
                returnResolver,
                returnPromise,
                started: Date.now(),
                action: { data },
            }
        }
        return sendPayloadInChunks<Output>(
            this,
            clientId,
            client,
            JSON.stringify({ data }),
            {
                type: 'json-action-invoke',
                metadata: JSON.stringify({
                    name: actionName,
                    iid,
                } as WsActionMetadata),
                iid,
            },
        )
    }

    async waitForActionAck(iid: string) {
        if (!this.invocationsRegistry[iid]) {
            return false
        }
        if (this.invocationsRegistry[iid].ackDisabled) {
            return true
        }
        return await this.invocationsRegistry[iid].ackPromise
    }

    waitForActionResult(iid: string, timeout?: number): Promise<Result> {
        if (!this.invocationsRegistry[iid]) {
            return promise(resolve => {
                resolve(
                    errorResult(
                        new Error(`action invoke id '${iid}' not found`),
                    ),
                )
            })
        }
        if (this.invocationsRegistry[iid].returned) {
            return promise(resolve => {
                resolve(this.invocationsRegistry[iid].returnResult)
            })
        }
        let resolver = null
        if (!isNaN(timeout) && timeout >= 0) {
            setTimeout(() => {
                resolver?.({
                    status: 'error',
                    message: `timed out after ${timeout} ms`,
                })
            }, timeout)
        }
        return promise(resolve => {
            resolver = resolve
            this.invocationsRegistry[iid].returnPromise.then(res => {
                resolve(res)
            })
        })
    }

    handlePayloadStart?: (pendingMessage: PendingMessage) => any
}

export class WsClientShim extends WsBaseShim {
    url: string | (() => Promise<string>)

    wsConnected = false
    wsConnecting = false
    wsLastPong = 0
    wsTerminate = false
    wsPingChecker: NodeJS.Timeout

    constructor(url?: string) {
        super('wsclient')
        if (url) {
            this.url = url
        }
    }

    get connection() {
        return this.clients[CLIENT_SELF_ID]
    }

    enableQueuing() {
        if (!this.queuedMessages) {
            this.queuedMessages = {}
        }
    }

    async connect() {
        if (!this.logger) {
            this.logger = new Logger(this)
        }
        const forever = true

        const maxReconnectWaitTime = this.options.maxReconnectWaitTime ?? 600000
        const effectiveMaxReconnectWaitTime =
            maxReconnectWaitTime * 0.5 +
            Math.random() * maxReconnectWaitTime * 0.5

        const baseReconnectWaitTime = 500
        let reconnectWaitTime = baseReconnectWaitTime

        const maxPongWaitTime = this.options.maxPongWaitTime ?? 30000

        while (forever) {
            try {
                await this.startConnection()
            } catch (e) {
                this.logger.error('ws startConnection', e)
            }
            if (this.wsTerminate) {
                return
            }
            if (Date.now() - this.wsLastPong < maxPongWaitTime) {
                reconnectWaitTime = baseReconnectWaitTime
            }
            this.wsLastPong = 0
            reconnectWaitTime +=
                reconnectWaitTime / 2 +
                Math.random() * (reconnectWaitTime / 2) +
                Math.random() * 7000 +
                baseReconnectWaitTime
            if (reconnectWaitTime > effectiveMaxReconnectWaitTime) {
                reconnectWaitTime = effectiveMaxReconnectWaitTime
            }
            this.logger.warn(
                `ws connection closed, restarting ${Math.round(reconnectWaitTime / 1000)} seconds ...`,
            )
            await new Promise(resolve => setTimeout(resolve, reconnectWaitTime))
        }
    }

    startConnection() {
        return promise(async resolve => {
            if (this.wsConnecting || this.wsConnected) {
                return resolve()
            }

            this.wsConnecting = true

            const clientId = CLIENT_SELF_ID

            try {
                let url =
                    typeof this.url === 'string' ? this.url : await this.url()
                const wsOptions = this.options?.wsOptions ?? {}
                if (!wsOptions.headers) {
                    wsOptions.headers = {}
                }
                if (this.options.wsHeaders) {
                    if (typeof this.options.wsHeaders === 'object') {
                        Object.assign(
                            wsOptions.headers,
                            deepCopy(this.options.wsHeaders),
                        )
                    } else {
                        Object.assign(
                            wsOptions.headers,
                            deepCopy(await this.options.wsHeaders()),
                        )
                    }
                }
                if (this.authHandler) {
                    url +=
                        url.indexOf('?') === -1
                            ? '?ws-bidirectional-auth'
                            : '&ws-bidirectional-auth'
                }
                this.clients[clientId] = new WebSocket(
                    url,
                    wsOptions,
                ) as WebSocketClient
            } catch (e) {
                this.logger.error('ws client connection open', e)
                this.wsConnecting = false
                return resolve()
            }

            const client = this.clients[clientId]
            client.clientId = clientId

            client.on('error', e => {
                this.logger.error('ws client generic', e)
            })

            client.on('open', () => {
                this.wsConnected = true
                this.wsConnecting = false
                this.wsLastPong = 0
                this.logger.info(`ws connection opened`)
                this.wsPingChecker = setInterval(() => {
                    try {
                        client.ping()
                    } catch (e) {
                        this.logger.error('ws ping', e)
                    }
                    const maxPongWaitTime =
                        this.options.maxPongWaitTime ?? 30000
                    if (
                        this.wsLastPong &&
                        Date.now() - this.wsLastPong > maxPongWaitTime
                    ) {
                        this.logger.warn(
                            `last pong too late (> ${maxPongWaitTime} ms); closing.`,
                        )
                        client.close()
                    }
                }, this.options.pingInterval ?? 15000)
            })

            client.on('pong', () => {
                this.wsLastPong = Date.now()
            })

            client.on('close', () => {
                this.wsConnected = false
                this.wsConnecting = false
                this.pendingMessages = {}
                this.logger.warn(`closed`)
                if (this.wsPingChecker) {
                    clearInterval(this.wsPingChecker)
                }
                resolve()
            })

            client.on(
                'message',
                (rawData: WebSocket.RawData, isBinary: boolean) => {
                    handleChunkedPayload(
                        this,
                        clientId,
                        client,
                        rawData,
                        isBinary,
                    )
                },
            )
        })
    }
}

export class WsServerShim extends WsBaseShim {
    constructor() {
        super()
        this.ix.setEntityId('wsservershim', true)
    }

    enableQueuing() {
        if (!this.queuedMessages) {
            this.queuedMessages = {}
        }
    }

    start(port: number) {
        if (!this.logger) {
            this.logger = new Logger(this)
        }
        const server = createServer()
        const wss = new WebSocketServer({ noServer: true })

        server.on('upgrade', async (request, socket, head) => {
            const endError = (error: string | Error) => {
                const e = typeof error === 'string' ? new Error(error) : error
                this.logger.error(e)
                socket.destroy()
                return null
            }
            try {
                wss.handleUpgrade(request, socket, head, async ws => {
                    const client = ws as WebSocketClient
                    if (request.headers?.authorization) {
                        client.token =
                            request.headers.authorization.split('Bearer ')[1]
                    }
                    const reqCheckResult = !this.authHandler
                        ? ok({
                              id: '',
                              roles: [],
                          } as BasicUserData)
                        : await this.authHandler(client, request)
                    if (!reqCheckResult) {
                        return endError(`ws server authorize: rejected`)
                    }
                    const userdata = reqCheckResult.data
                    const userdataJson = Codec.utf8ToBase64(
                        JSON.stringify(userdata),
                    )
                    if (userdataJson.length > 2048) {
                        return endError(
                            `userdata base64 length exceeds 2048 bytes`,
                        )
                    }
                    if (!client.userdata) {
                        client.userdata = {}
                    }
                    client.userdata.local = userdata
                    client.send(`userdata|set|${userdataJson}`)
                    let authString: string
                    const bidirectionalAuth =
                        request.url.indexOf('ws-bidirectional-auth') >= 0
                    if (bidirectionalAuth) {
                        if (!this.authTokenProvider) {
                            return endError(
                                `client requires auth but server has no authTokenProvider set`,
                            )
                        }
                        try {
                            const authStringResult =
                                await this.authTokenProvider(client, request)
                            if (!authStringResult.ok) {
                                return endError(
                                    `client requires auth but server cannot fetch auth credentials`,
                                )
                            }
                            client.bidirectionalAuth = true
                            authString = authStringResult.data
                            client.send(
                                `auth|token|${Codec.utf8ToBase64(authString)}`,
                            )
                            const remoteUserdataWaitTime =
                                this.options.maxBidirectionalAuthWaitTime ??
                                7000
                            setTimeout(() => {
                                // client still not responded with userdata; auth failed
                                if (
                                    client.readyState === client.OPEN &&
                                    !client.userdata?.remote
                                ) {
                                    this.logger.error(
                                        `ws client bidirectional auth remote did not send userdata within ${remoteUserdataWaitTime} ms`,
                                    )
                                    client.close()
                                }
                            }, remoteUserdataWaitTime)
                        } catch (e) {
                            return endError(e)
                        }
                    }
                    wss.emit('connection', client, request)
                })
            } catch (e) {
                return endError(e)
            }
        })

        wss.on('connection', (client: WebSocketClient, req) => {
            const clientId = uuidv4()
            this.clients[clientId] = client
            client.clientId = clientId
            this.logger.info(`ws connection opened (${clientId})`)

            this.onClientOpen?.(client, req)

            client.on('error', e => {
                this.logger.error(`ws error from client (${clientId})`, e)
            })

            client.on('close', () => {
                if (this.clients[clientId]) {
                    delete this.clients[clientId]
                }
                this.onClientClose?.(client)
            })

            client.on(
                'message',
                (rawData: WebSocket.RawData, isBinary: boolean) => {
                    handleChunkedPayload(
                        this,
                        clientId,
                        client,
                        rawData,
                        isBinary,
                    )
                },
            )
        })

        server.listen(port)
    }

    onClientClose(client: WebSocketClient) {
        client
    }

    onClientOpen(client: WebSocketClient, req: IncomingMessage) {
        client
        req
    }
}

async function handleChunkedPayload(
    shim: WsBaseShim,
    clientId: string,
    client: WebSocketClient,
    rawData: WebSocket.RawData,
    isBinary: boolean,
) {
    if (!isBinary) {
        const data = rawData.toString('utf8')
        if (data.startsWith('msg|')) {
            const lit = data.split('|')
            const id = lit[1]
            const info = lit[2]
            if (info.startsWith('content-length=')) {
                if (shim.pendingMessages[id]) {
                    shim.logger.error(`payload id collision '${id}'`)
                    return
                }
                const size = parseInt(info.split('=')[1])
                const type = lit[3] as WsMessageType
                const compression = lit[4]
                const metadata = lit[5]
                const metadataExtra = lit[6]
                let actionName: string = null
                let actionIid: string = null
                if (type === 'json-action-invoke') {
                    try {
                        const actionMetadata: WsActionMetadata =
                            JSON.parse(metadata)
                        if (!actionMetadata?.name) {
                            shim.logger.error(
                                `ws action name not given in metadata`,
                            )
                            return
                        }
                        if (!actionMetadata?.iid) {
                            shim.logger.error(
                                `ws action invocation id not given in metadata`,
                            )
                            return
                        }
                        actionName = actionMetadata.name
                        actionIid = actionMetadata.iid
                    } catch (e) {
                        shim.logger.error(`ws json-action metadata`, e)
                        return
                    }
                    if (!shim.actionsRegistry[actionName]) {
                        shim.logger.error(`action unrecognized '${actionName}'`)
                        client.send(
                            `msg|${id}|content-length=0|json-action-ack|none|${actionIid}|false`,
                        )
                        return
                    }
                    client.send(
                        `msg|${id}|content-length=0|json-action-ack|none|${actionIid}|true`,
                    )
                } else if (type === 'json-action-ack') {
                    const actionIid = metadata
                    if (!actionIid) {
                        shim.logger.error(`json-action-ack needs invocation id`)
                        return
                    }
                    if (!shim.invocationsRegistry[actionIid]) {
                        shim.logger.error(
                            `json-action-ack unrecognized iid '${actionIid}'`,
                        )
                        return
                    }
                    shim.invocationsRegistry[actionIid].ack = true
                    if (shim.invocationsRegistry[actionIid].ackDisabled) {
                        return
                    }
                    const success = metadataExtra === 'true'
                    shim.invocationsRegistry[actionIid].ackResolver(success)
                    if (
                        !success &&
                        !shim.invocationsRegistry[actionIid].returned
                    ) {
                        const actionResult = errorResult(
                            new Error('json_action_ack_failure'),
                        )
                        shim.invocationsRegistry[actionIid].returned = true
                        shim.invocationsRegistry[actionIid].returnResult =
                            actionResult
                        shim.invocationsRegistry[actionIid].returnResolver(
                            actionResult,
                        )
                        setTimeout(() => {
                            if (shim.invocationsRegistry[actionIid]) {
                                delete shim.invocationsRegistry[actionIid]
                            }
                        }, 30000)
                    }
                    return
                }
                const pendingMessage = {
                    id,
                    type,
                    compression,
                    metadata,
                    started: Date.now(),
                    buffer: null,
                    actionName,
                    actionIid,
                    range: {
                        start: -1,
                        end: -1,
                    },
                }
                shim.pendingMessages[id] = pendingMessage
                if (shim.handlePayloadStart) {
                    if (!shim.handlePayloadStart(pendingMessage)) {
                        // denied by handlePayloadStart handler
                        return
                    }
                }
                pendingMessage.buffer = Buffer.allocUnsafe(size)
                shim.pendingMessages[id] = pendingMessage
            } else if (info.startsWith('chunk-range=')) {
                if (!shim.pendingMessages[id]) {
                    shim.logger.error(
                        `unknown message '${id}' when adding payload chunk`,
                    )
                    return
                }
                const rangeStr = info.split('=')[1]
                const rangeLit = rangeStr.split('-')
                shim.pendingMessages[id].range = {
                    start: parseInt(rangeLit[0]),
                    end: parseInt(rangeLit[1]),
                }
            } else if (info === 'end') {
                if (!shim.pendingMessages[id]) {
                    shim.logger.error(
                        `unknown message '${id}' when finalizing payload chunks`,
                    )
                    return
                }
                try {
                    const msgObj = shim.pendingMessages[id]
                    handlePayload(shim, clientId, client, msgObj)
                } catch (e) {
                    shim.logger.error('payload end error', e)
                }
            } else {
                shim.logger.error(
                    `unknown ws message type (id=${id}), '${info}'`,
                )
            }
            return
        } else if (data.startsWith('userdata|')) {
            const lit = data.split('|')
            const op = lit[1]
            const opdata = lit[2]
            if (op === 'set') {
                try {
                    const userdata = JSON.parse(Codec.base64ToUtf8(opdata))
                    if (userdata) {
                        if (!client.userdata) {
                            client.userdata = {}
                        }
                        client.userdata.remote = userdata
                        if (client.clientId === CLIENT_SELF_ID) {
                            shim.logger.info(
                                `ws client user data set`,
                                userdata,
                            )
                        } else {
                            shim.logger.info(
                                `ws server user data set`,
                                userdata,
                            )
                        }
                    }
                } catch (e) {
                    shim.logger.error(e)
                }
            }
        } else if (data.startsWith('auth|')) {
            const lit = data.split('|')
            const kind = lit[1]
            const opdata = lit[2]
            if (kind === 'token' && opdata) {
                try {
                    const token = Codec.base64ToUtf8(opdata)
                    client.token = token
                    if (!shim.authHandler) {
                        shim.logger.error(
                            'ws server bidirectional auth error; client has no authHandler',
                        )
                        client.close()
                        return
                    }
                    const authRes = await shim.authHandler?.(client, null)
                    client.token = null
                    if (!authRes.ok) {
                        shim.logger.error(
                            'ws server bidirectional auth',
                            authRes.error,
                        )
                        client.close()
                        return
                    }
                    const userdata = authRes.data
                    if (!client.userdata) {
                        client.userdata = {}
                    }
                    client.userdata.local = userdata
                    const userdataJson = Codec.utf8ToBase64(
                        JSON.stringify(userdata),
                    )
                    client.send(`userdata|set|${userdataJson}`)
                } catch (e) {
                    shim.logger.error(e)
                }
            }
        } else {
            // TODO
        }
        return
    }
    const dataBuffer: Buffer = rawData as Buffer
    const isBase64EncodedId = dataBuffer[0] < 128
    const idByteLength =
        dataBuffer[0] >= 128 ? dataBuffer[0] - 128 : dataBuffer[0]
    const idBytes = dataBuffer.subarray(1, idByteLength + 1)
    const id = isBase64EncodedId
        ? idBytes.toString('base64')
        : idBytes.toString('ascii')
    const pendingMessageObj = shim.pendingMessages[id]
    if (!pendingMessageObj) {
        shim.logger.error(`ws message chunk id '${id}' not recognized`)
        return
    }
    try {
        dataBuffer.copy(
            pendingMessageObj.buffer,
            pendingMessageObj.range.start,
            idByteLength + 1,
        )
    } catch (e) {
        shim.logger.error('ws message byte buffer error', e)
    }
}

async function sendPayloadInChunks<T = any>(
    shim: WsBaseShim,
    clientId: string,
    client: WebSocketClient,
    payloadPre: string | Buffer,
    options?: WsChunkedSendingOptions,
): Promise<Result<T>> {
    const {
        iid,
        type = 'json-action-invoke',
        metadata = '',
        compression = 'zlib',
        sliceSize = 2048,
        chunkSendInterval = 1,
        resendExpiry = 600000,
        maxOfflineDataHeapPerClient = 10485760, // 10 MB
        maxOfflineDataDiskPerClient = 1073741824, // 1 GB
        timeout = 7000,
    } = options

    let offline = false
    if (client.readyState !== client.OPEN) {
        offline = true
        if (!shim.queuedMessages) {
            return errorResult(
                new Error(
                    `cannot sendPayloadInChunks without ws in open state`,
                ),
            )
        }
    }

    const queueId = offline ? uuidv4() : ''

    if (offline && !shim.queuedMessages[clientId]) {
        shim.queuedMessages[clientId] = {
            dataLength: 0,
            queue: {},
        }
    }
    if (offline) {
        shim.queuedMessages[clientId].queue[queueId] = []
    }

    const offlineQueueObj = shim.queuedMessages?.[clientId] ?? null
    const send = (msg: string | Buffer) => {
        if (offline) {
            if (
                offlineQueueObj.dataLength + msg.length >
                maxOfflineDataHeapPerClient
            ) {
                shim.logger.error(
                    new Error(
                        `Max offline queue data in memory exceeded ${maxOfflineDataHeapPerClient}`,
                    ),
                )
                return
            }
            offlineQueueObj.dataLength += msg.length
            offlineQueueObj.queue[queueId].push(msg)
        } else {
            client.send(msg)
        }
    }

    const idRaw = randomBytes(9)
    const id = idRaw.toString('base64')
    const idHeader = Buffer.concat([Buffer.from([9]), idRaw])
    let payload: Buffer =
        typeof payloadPre === 'string'
            ? Buffer.from(payloadPre, 'utf8')
            : payloadPre
    if (compression === 'zlib') {
        const payloadCompressed = await zlibCompress(payload)
        if (payloadCompressed instanceof Error) {
            shim.logger.error(`ws zlib deflate error`, payloadCompressed)
            return
        } else {
            payload = payloadCompressed
        }
    }

    try {
        const divResult = payload.length / sliceSize
        let chunks = Math.floor(divResult)
        const hasRemainder = divResult > chunks
        if (hasRemainder) {
            chunks += 1
        }
        const lastChunkLength = hasRemainder
            ? Math.round((divResult - chunks + 1) * sliceSize)
            : sliceSize

        let currentAt = 0

        const starterHeader = `msg|${id}|content-length=${payload.length}|${type}|${compression}|${metadata}`
        send(starterHeader)

        if (!offline && type === 'json-action-invoke') {
            const ackResult = await shim.waitForActionAck(iid)
            if (!ackResult) {
                shim.logger.warn(`action invoke ack error`)
                return
            }
        }

        for (let i = 0; i < chunks; ++i) {
            const isLastChunk = i === chunks - 1
            const dataLength = isLastChunk ? lastChunkLength : sliceSize
            const end = currentAt + dataLength
            const slice = payload.subarray(currentAt, end)
            const middleChunkHeader = `msg|${id}|chunk-range=${currentAt}-${end}`
            const middleChunk = Buffer.concat([idHeader, slice])

            send(middleChunkHeader)
            send(middleChunk)

            currentAt += dataLength

            if (chunkSendInterval < 0) {
                continue
            } else if (chunkSendInterval === 0) {
                await promise(resolve => setImmediate(resolve))
            } else if (chunkSendInterval) {
                await promise(resolve => setTimeout(resolve, chunkSendInterval))
            }
        }

        const endingHeader = `msg|${id}|end`
        send(endingHeader)
    } catch (e) {
        shim.logger.error(`Chunked message transfer error`, e)
        return e
    }

    if (!offline && type === 'json-action-invoke') {
        const actionResult = await shim.waitForActionResult(iid)
        return actionResult
    }

    return ok(null)
}

async function handlePayload(
    shim: WsBaseShim,
    clientId: string,
    client: WebSocketClient,
    msg: PendingMessage,
) {
    const handleRaw = async (message: Buffer) => {
        try {
            if (msg.type === 'json-action-invoke') {
                const actionData: WsActionData = JSON.parse(
                    message.toString('utf8'),
                )
                try {
                    let result: Result
                    const actionDef = shim.actionsRegistry[msg.actionName]
                    const rolesApplicable: string[] = []
                    if (actionDef.authRubric) {
                        if (Array.isArray(actionDef.authRubric)) {
                            const map = valueMap(actionDef.authRubric)
                            const clientRoles =
                                client.userdata?.local?.roles ?? []
                            clientRoles.forEach(role => {
                                if (map[role]) {
                                    rolesApplicable.push(role)
                                }
                            })
                            if (
                                actionDef.authRubric.length > 0 &&
                                !rolesApplicable.length
                            ) {
                                result = errorResult(
                                    new Error(
                                        `client roles [${clientRoles.join(', ')}] ` +
                                            `not sufficient for action auth roles requirement [${actionDef.authRubric.join(', ')}]`,
                                    ),
                                )
                            }
                        } else {
                            const authRes = await actionDef.authRubric(
                                client,
                                actionData,
                                rolesApplicable,
                            )
                            if (!authRes.ok) {
                                result = authRes
                            }
                        }
                    }
                    if (!result) {
                        result = await actionDef.logic(
                            client,
                            actionData,
                            rolesApplicable,
                        )
                    }
                    sendPayloadInChunks(
                        shim,
                        clientId,
                        client,
                        JSON.stringify(result),
                        {
                            type: 'json-action-return',
                            metadata: msg.actionIid,
                        },
                    )
                } catch (e2) {
                    sendPayloadInChunks(
                        shim,
                        clientId,
                        client,
                        JSON.stringify(errorResult(e2)),
                        {
                            type: 'json-action-return',
                            metadata: msg.actionIid,
                        },
                    )
                }
            } else if (msg.type === 'json-action-return') {
                const iid = msg.metadata
                if (!shim.invocationsRegistry[iid]) {
                    shim.logger.error(
                        `json-action-return on non-existent iid '${iid}'`,
                    )
                    return
                }
                const resultData = Result.from(message.toString('utf8'))
                shim.invocationsRegistry[iid].returned = true
                shim.invocationsRegistry[iid].returnResult = resultData
                shim.invocationsRegistry[iid].returnResolver(resultData)
                setTimeout(() => {
                    if (shim.invocationsRegistry[iid]) {
                        delete shim.invocationsRegistry[iid]
                    }
                }, 30000)
            }
        } catch (e) {
            shim.logger.error('payload handling error', e)
        }
    }
    if (!msg.compression) {
        handleRaw(msg.buffer)
    } else if (msg.compression === 'zlib') {
        zlib.inflateRaw(msg.buffer, (e, uncompressed) => {
            if (e) {
                shim.logger.error('zlib inflate error', e)
                return
            }
            handleRaw(uncompressed)
        })
    } else {
        shim.logger.error(`unrecognized compression '${msg.compression}'`)
    }
}

function zlibCompress(payload: Buffer): Promise<Buffer | Error> {
    return promise(resolve => {
        zlib.deflateRaw(payload, { level: 7 }, (e, compressed) => {
            if (e) {
                resolve(e)
                return
            }
            resolve(compressed)
        })
    })
}
