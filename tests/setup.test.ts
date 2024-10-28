import { AuthServer, DestorServer } from '../nodejs'
import { TestConfig } from 'ts-dsl'
import * as creds from './secrets/test.secrets.json'
import { loadTopologyConfig } from '../src/common/env/config.loader'

TestConfig.prepareBeforeAnyTest(async () => {
    process.env.DESTOR_SERVER_CONFIG_FILE = 'tests/secrets/destor.properties'
    process.env.DESTOR_SERVER_BASE_TOKEN = creds.baseToken
    process.env.DESTOR_SERVER_SIGNING_KEY = creds.fourq.privateKey
    process.env.DESTOR_SERVER_PORT = '11234'

    process.env.AUTH_SERVER_CONFIG_FILE = 'tests/secrets/auth.properties'
    process.env.AUTH_SERVER_APP_PROFILE = 'test'
    process.env.AUTH_SERVER_INDEX_KEY = 'default'

    process.env.UPSTREAM_MONGO_HTTP_INDEX_KEY = 'upstreamHttpServer'

    loadTopologyConfig(`---
  destor:
    -
      url: 'http://localhost:${11234}'
      token: '${creds.baseToken}'
      trust:
        type: 'ECC_4Q'
        publicKey: '${creds.fourq.publicKey}'
  primaryDatastore:
    endpoint: 'http://localhost:${31234}/api/v1'
  `)

    const destor = new DestorServer()
    await destor.start()

    const authServer = new AuthServer()
    authServer.config.showServerInfo = true
    await authServer.start()
})
