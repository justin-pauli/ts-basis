import { Result } from '../../src'
import { testDefine, msleep, DSL_ON, http } from 'lugger'
DSL_ON

testDefine(
    { runAlone: true },
    `auth server should have GET /universe /profile as app profile`,
)
{
    const res = http.get<Result<{ universe: string }>>(
        'http://localhost:21234/universe',
    )
    res.data.result.universe === process.env.AUTH_SERVER_APP_PROFILE
    res.data.server.startsWith(process.env.AUTH_SERVER_INDEX_KEY)

    const res2 = http.get<Result<{ profile: string }>>(
        'http://localhost:21234/profile',
    )
    res2.data.result.profile === process.env.AUTH_SERVER_APP_PROFILE
    res2.data.server.startsWith(process.env.AUTH_SERVER_INDEX_KEY)
}
