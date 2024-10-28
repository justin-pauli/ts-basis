import { DSL_ON, echo, msleep, testDefine } from 'lugger'
import { UpstreamDatastoreMongoOverHttp } from '../../nodejs/upstream/mongodb/mongodb-over-http'
import {
    HttpMethod,
    promise,
    Promise2,
    push,
    Upstream,
    UpstreamDatastoreConfig,
    UpstreamHttpDatastore,
    UpstreamHttpDatastoreCredentials,
} from '../../src'
import { TestClassData } from './upstream.odm'
DSL_ON

const httpMongoDsConfig: UpstreamDatastoreConfig<UpstreamHttpDatastoreCredentials> =
    {
        path: 'local',
        endpoint: {
            type: 'http',
            endpoint: `http://localhost:${31234}/api/v1`,
            credentials: { authHeaders: {} },
        },
    }

testDefine(
    { runAlone: true },
    `Upstream should honor sparse index with null over http`,
)
{
    Upstream.forTest.purge()
    const server = new UpstreamDatastoreMongoOverHttp()
    server.start()
    Upstream.add(new UpstreamHttpDatastore(httpMongoDsConfig))
    Upstream.admin(TestClassData).dropCollection()
    Upstream.admin(TestClassData).recreateIndexes()
    const a = new TestClassData()
    const b = new TestClassData()
    const c = new TestClassData()
    push(a)
    push(b)
    push(c)
    a.prop1 = 'test1'
    b.prop1 = 'test1'
    c.prop1 = 'test2'
    msleep(1000)
    Upstream.delete(c)
    msleep(1000)
    Upstream.httpCrud('POST', TestClassData, 'prop1', { prop1: 'test3' })
    Upstream.httpCrud('PATCH', TestClassData, 'prop1', {
        prop1: 'test3',
        propPre: 'test',
    })
    Upstream.httpCrud('GET', TestClassData, 'prop1', { prop1: 'test3' })
    Upstream.httpCrud('DELETE', TestClassData, 'prop1', { prop1: 'test3' })
}
