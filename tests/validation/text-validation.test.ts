import { DSL_ON, echo, msleep, testDefine } from 'lugger'
import { vv } from '../../src'
DSL_ON

testDefine(`Text validation 'wordsAndUnderscores' should work`)
{
    vv.text.wordsAndUnderscores.conform('') === ''
    vv.text.wordsAndUnderscores.conform(`test 甲骨文 -- 文a - a_d文 `) ===
        `test_甲骨文_文a_a_d文`
    vv.text.wordsAndUnderscores.conform(`  __ test 甲骨文 __ `, {
        trim: false,
    }) === `_test_甲骨文_`
}

testDefine(`Text validation 'wordsAndSpaces' should work`)
{
    vv.text.wordsAndSpaces.conform('') === ''
    vv.text.wordsAndSpaces.conform(`test 甲骨文 -- 文--a - a_d文 `) ===
        `test 甲骨文 文-a a_d文`
    vv.text.wordsAndSpaces.conform(`  __ test 甲骨文 str_--_--_----ing__ `) ===
        `test 甲骨文 str-ing`
}
