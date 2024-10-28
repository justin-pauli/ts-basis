import { asDataclass, ClassLineage } from '../../src'
import { TestClass2A, TestClass2B } from '../temp/upstream.odm2'
import { TestClassData } from './upstream.odm'
// import { TestClass } from "./datactl.odm";

// console.log(TestClass22);
// // console.log(TestClass.index);

// console.log(new TestClass22);

// console.log(asDataclass(TestClass22).fullname);
console.log(ClassLineage.commonAncestorsInfo(TestClass2A, TestClass2B))
