import { DSL_ON, echo, msleep, testDefine } from 'lugger'
import { UpstreamDatastoreMongo } from '../../nodejs/upstream/mongodb/mongodb'
import { push, Upstream } from '../../src'
import { TestClassData } from './upstream.odm'
DSL_ON

const localMongoDsConfig = {
    path: 'local',
    endpoint: {
        type: 'mongo',
        endpoint: 'localhost',
        credentials: { endpoint: 'localhost:27017' },
    },
}

testDefine({ runAlone: true }, `Upstream should honor sparse index with null`)
{
    Upstream.forTest.purge()
    Upstream.add(new UpstreamDatastoreMongo(localMongoDsConfig))
    Upstream.admin(TestClassData).dropCollection()
    Upstream.admin(TestClassData).recreateIndexes()
    push(new TestClassData())
    push(new TestClassData())
    msleep(1)
}
