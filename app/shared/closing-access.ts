import {operationsManager} from './operations';
import {has,manages,type Member,type Capability} from './types';

// Whole-store closing is explicitly reviewed access, never inferred from title.
// Keep the normal department restriction and require each closing permission.
export function canManageClosing(member:Member,area:string,capability:Capability){
 return manages(member,area,capability)||has(member,capability)&&operationsManager(member,area);
}
