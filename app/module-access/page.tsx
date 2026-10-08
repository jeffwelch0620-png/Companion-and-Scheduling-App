import ConnectedWorkspace from '../team/workspace';
import {parseRoleHomeKind} from '../shared/role-home-target';
export const dynamic='force-dynamic';
export default async function ModuleAccessPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,role=parseRoleHomeKind(params.role),location=typeof params.location==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(params.location)?params.location:undefined;
 return <ConnectedWorkspace signInPath="/login" roleHome={{role,initialLocation:location}}/>;
}
