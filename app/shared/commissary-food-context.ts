import type {Workspace} from './types';
import type {WorkspaceMembership} from './workspace-context';
import {commissaryRestaurants} from './restaurant-access';
export type CommissaryFoodContext=Pick<Workspace,'location'|'me'> & {commissaryOnly:true};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export const approvedCommissaryFoodLocations=(locations:WorkspaceMembership[])=>locations.filter(location=>commissaryRestaurants.some(id=>id===location.locationId));
// Membership metadata and a destination Food context are separate from the
// membership list used to select the general restaurant workspace.
export function verifiedCommissaryFoodContext(value:unknown,target:Pick<WorkspaceMembership,'locationId'|'id'>):CommissaryFoodContext{
 if(!commissaryRestaurants.some(id=>id===target.locationId)||!object(value)||value.commissaryOnly!==true||!object(value.location)||!object(value.me)||value.location.id!==target.locationId||value.me.id!==target.id||typeof value.location.name!=='string'||typeof value.location.timezone!=='string'||typeof value.me.name!=='string'||!Array.isArray(value.me.capabilities))throw Error('The Food access scope could not be verified. Refresh before continuing.');
 return value as CommissaryFoodContext;
}
