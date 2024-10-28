import { IncomingMessage } from 'http'
import { WsClientShim, WsServerShim } from '../../nodejs/ws/ws.shim'
import fs from 'fs'
import { P384 } from '../../nodejs/crypto/ecc.p-384'
import {
    AdvancedTokenAuth,
    AdvancedTokenDetails,
    SigningScheme,
} from '../../src/common/security/token.util'
import { ok } from '../../src/common/util/enum.util'

export class TestWsServer extends WsServerShim {}

export class TestWsClient extends WsClientShim {}

const server = new TestWsServer()
server.authTokenProvider = async (client, req) => {
    return ok('token')
}
server.authHandler = async (client, req) => {
    console.log(`client initiated auth, token:`, client.token)
    const userdata = {
        id: 'test',
        roles: ['tester'],
        info: {},
    }
    return ok(userdata)
}
server.registerAction<string, string>(
    'echo',
    ['tester'],
    async (client, action) => {
        return ok(action.data + ' (server echoed)')
    },
)
server.start(8888)

const client = new TestWsClient('http://localhost:8888')
client.authHandler = async (client, req) => {
    console.log(`server initiated auth, token:`, client.token)
    const userdata = {
        id: 'test',
        roles: ['tester'],
        info: {},
    }
    return ok(userdata)
}
client.registerAction<string, string>(
    'echo',
    ['tester'],
    async (client, action) => {
        return ok(action.data + ' (client echoed)')
    },
)
client.connect()

setTimeout(() => {
    client.sendJsonAction<string, string>('echo', 'test').then(r => {
        console.log(r)
        server
            .sendJsonAction<
                string,
                string
            >('echo', 'test', Object.keys(server.clients)[0])
            .then(r2 => {
                console.log(r2)
            })
    })
}, 2000)

// setTimeout(async () => {
//     const ecc = new P384()
//     const result = ecc.validateCertAndKey(P384.sample.publicCert, P384.sample.privateKey)
//     // console.log(result)

//     const publicKey = await ecc.getPublicKeyFromCert(P384.sample.publicCert)
//     const signingKey = await ecc.getSigningKey(P384.sample.privateKey)
//     const signature = await ecc.sign(signingKey, 'test')
//     // console.log(signature)
//     // console.log(await ecc.verify(publicKey, signature, 'test'))

//     const adv = new AdvancedTokenAuth()
//     adv.setTokenFetcher(async (name) => {
//         const details: AdvancedTokenDetails = {
//             token: 'askeskjfskjbsd',
//             signingScheme: {
//                 kind: 'EC',
//                 type: 'ECDSA',
//                 curveName: 'P-384',
//                 publicCert: P384.sample.publicCert
//             },
//             userdata: {
//                 id: 'test',
//                 info: {},
//                 roles: []
//             }
//         }
//         return details
//     })
//     adv.setSignatureVerifier(async (scheme, sig, message) => {
//         console.log(scheme, sig, 'payload', message.length)
//         return await ecc.verify(publicKey, sig, message)
//     })
//     adv.setMessageSigner(async (msg) => {
//         return await ecc.sign(signingKey, msg)
//     })
//     const advTokenResult = await adv.createAdvancedToken('name', 'askeskjfskjbsd', 'test', 'best')
//     console.log(advTokenResult)

//     // console.log(advToken)
//     console.log(await adv.verify(advTokenResult.data))
// })
