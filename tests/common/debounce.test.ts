import { DSL_ON, echo, msleep, testDefine } from 'lugger'
import { debounce, vv } from '../../src'
DSL_ON

testDefine(`Debounce should work`)
{
    const a = debounce(200)
    let test = 1
    a.run(() => {
        test += 1
    })
    test === 1
    msleep(100)
    a.run(() => {
        test += 1
    })
    test === 1
    for (let i = 0; i < 50; ++i) {
        msleep(5)
        a.run(() => {
            test += 1
        })
    }
    msleep(300)
    test === 2
}

testDefine(`Debounce should work with unique name`)
{
    const a = debounce(200, 'test')
    const b = debounce(200, 'test')
    const c = debounce(200, 'test')
    let test = 1
    a.run(() => {
        test += 1
    })
    b.run(() => {
        test += 1
    })
    c.run(() => {
        test += 1
    })
    test === 1
    msleep(300)
    test === 2
}
