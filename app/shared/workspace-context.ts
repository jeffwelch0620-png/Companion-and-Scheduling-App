export type WorkspaceMembership = { id:string; locationId:string; locationName:string; name:string; position:string };
type Selection = { memberId:string; locationId:string };
type Storage = Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
type ScopedWorkspace = { location:{id:string}; me:{id:string} };
export class WorkspaceRequestError extends Error {
  constructor(message:string,public status:number){super(message)}
}

// A per-tab preference contains identifiers only. It never grants access: both
// the current membership list and the scoped server response must match it.
export function restaurantPreference(apiRoot:string,storage:()=>Storage) {
  const key='jmax.restaurant.v1:'+apiRoot;
  return {
    read():Selection|null {
      try {
        const value:unknown=JSON.parse(storage().getItem(key)??'null');
        if(value&&typeof value==='object'&&'memberId' in value&&'locationId' in value&&typeof value.memberId==='string'&&typeof value.locationId==='string')return {memberId:value.memberId,locationId:value.locationId};
      } catch { /* Storage can be disabled, full or contain an older value. */ }
      return null;
    },
    write(value:Selection){try{storage().setItem(key,JSON.stringify(value))}catch{/* The workspace still works without persistence. */}},
    clear(){try{storage().removeItem(key)}catch{/* Best effort on sign-out or lost access. */}},
  };
}

export function createWorkspaceLoader<W extends ScopedWorkspace>(options:{
  memberships:()=>Promise<{memberships:WorkspaceMembership[];commissaryFoodLocations?:WorkspaceMembership[]}>;
  workspace:(locationId:string)=>Promise<W>;
  preference:ReturnType<typeof restaurantPreference>;
}) {
  let generation=0,loading=false,active:Selection|null=null;
  return {
    isLoading:()=>loading,
    invalidate(){generation++;loading=false},
    clear(){generation++;loading=false;active=null;options.preference.clear()},
    async load(locationId?:string) {
      const token=++generation;loading=true;
      try {
        const {memberships,commissaryFoodLocations=[]}=await options.memberships();
        if(token!==generation)return;
        const preferred=active??options.preference.read();
        const remembered=preferred&&memberships.find(m=>m.id===preferred.memberId&&m.locationId===preferred.locationId);
        const member=locationId?memberships.find(m=>m.locationId===locationId):remembered||memberships[0];
        if(!member)throw new WorkspaceRequestError(locationId?'Your access to that restaurant is no longer available. Refresh to choose an available restaurant.':'Your restaurant access needs to be configured.',403);
        const workspace=await options.workspace(member.locationId);
        if(token!==generation)return;
        if(workspace.location.id!==member.locationId||workspace.me.id!==member.id)throw new WorkspaceRequestError('Your sign-in changed while loading. Refresh your workspace.',401);
        const changed=active?.memberId!==member.id||active?.locationId!==member.locationId;
        const selection={memberId:member.id,locationId:member.locationId};
        active=selection;options.preference.write(selection);
        return {workspace,memberships,commissaryFoodLocations,changed,notice:!locationId&&preferred&&!remembered?'Your previous restaurant selection is no longer available. Showing '+member.locationName+'.':''};
      } catch(error) {
        // Neither late failures nor late successes can replace a newer view.
        if(token!==generation)return;
        if(error instanceof WorkspaceRequestError&&[401,403].includes(error.status)){active=null;options.preference.clear()}
        throw error;
      } finally {if(token===generation)loading=false}
    },
  };
}
