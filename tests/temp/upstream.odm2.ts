import { asDataclass } from '../../src'
import { TestClassData } from '../upstream/upstream.odm'

export interface DataControllerClassRequirement<T = any> {
    as: any
}

export interface UpstreamDataControllerInfo {}

/**
 *
 * @param nsc Namespace Consortirum this class falls under
 * @returns decorator for input class with upstream data initialized
 */
// export function datacontrol(nscInfo?: UpstreamDataControllerInfo) {
//   console.log('datactl called');
//   return function <U extends DataControllerClassRequirement>(type: U) {
//     return type;
//   }
// }

// @datacontrol()
export class TestClass extends TestClassData {
    static as: (...a: any[]) => { test: string }
    data2?: string = 'test'
}

export class TestClass2A extends TestClass {}

export class TestClass2B extends TestClass {}

// console.log(TestClass);
// TestClass.as('user').test

// asDataclass(TestClass).
