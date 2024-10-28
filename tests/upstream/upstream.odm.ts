import { Class, dataclass, ModelDef, semver, Upstream } from '../../src'

function firstt<T = any>(type: Class<T>) {
    console.log('first(): factory evaluated')
    return (
        target: T,
        propertyKey: string,
        descriptor?: TypedPropertyDescriptor<any>,
    ) => {
        console.log('first(): called')
    }
}

@dataclass({ classVersion: semver('0.0.1') })
export class TestClassPreData {
    static index: typeof TestClassDataPreUpstream.index

    // @firstt(TestClassPreData)
    propPre: string = null

    constructor(init?: Partial<TestClassPreData>) {
        ModelDef(this, TestClassPreData, init, {})
    }
}

@dataclass({ classVersion: semver('0.0.1') })
export class TestClassData extends TestClassPreData {
    static index: typeof TestClassDataUpstream.index

    // @firstt(TestClassData)
    prop1: string = null

    second: string = 'test'

    constructor(init?: Partial<TestClassData>) {
        super(init)
        ModelDef(this, TestClassData, init, {})
    }
}

const TestClassDataPreUpstream = {
    index: Upstream.index(TestClassPreData, addIndex => ({
        primary: addIndex(
            { unique: true },
            {
                propPre: true,
            },
        ),
    })),
}

const TestClassDataUpstream = {
    index: Upstream.index(TestClassData, addIndex => ({
        primary: addIndex(
            { unique: true },
            {
                prop1: true,
            },
        ),
        secondary: addIndex(
            {},
            {
                second: true,
            },
        ),
    })),
}
