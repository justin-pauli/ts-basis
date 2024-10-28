import { loadTopologyConfig } from '../../src/common/env/config.loader'
import { testDefine, msleep, DSL_ON } from 'lugger'
DSL_ON

testDefine(
    { runAlone: true },
    `Config loader should be able to load simple config from yaml source`,
)
{
    const config = loadTopologyConfig(
        `---
  destor:
    -
      url: 'http://localhost:test_port'
      token: 'test_token'
      trust:
        type: 'DEFAULT'
        publicKey: 'trust_pubkey'
  primaryDatastore:
    endpoint: 'http://localhost:test_port_2/api/v1'
  `,
        true,
    )
    config.primaryDatastore.endpoint === 'http://localhost:test_port_2/api/v1'
    config.primaryDatastore.profile === 'test'
    config.primaryDatastore.domain === 'local'
    config.primaryDatastore.type === 'http'
    config.primaryDatastore.endpoint === 'http://localhost:test_port_2/api/v1'
    config.destor[0].url === 'http://localhost:test_port'
    config.destor[0].token === 'test_token'
    config.destor[0].trust.type === 'DEFAULT'
    config.destor[0].trust.publicKey === 'trust_pubkey'
}
