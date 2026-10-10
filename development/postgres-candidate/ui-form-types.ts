import type {WorkRecord} from '../../app/shared/types';
// Keep the current shared form callback contract without importing the active page.
export type Send=(action:string,input:Record<string,unknown>,record?:WorkRecord)=>Promise<boolean>;
