import type {CommandResult,Workspace,WorkRecord} from './types';

// First shared slice deliberately keeps the existing Companion IDs and command model.
// No catalog import, alternate identity selection or D1 fallback is part of this route.
export const sharedStoreActions=['managerlog.create','managerlog.note'] as const;
export const sharedStoreCookie='__Host-jmax-shared-access';
export type SharedStoreMembership={id:string;locationId:string;name:string;position:string;locationName:string};
export type SharedStoreUser={id:string;email?:string};
export type SharedStoreSnapshot={workspace:Workspace;membershipRevision:number};
export type SharedStoreBindings={SUPABASE_URL?:string;SUPABASE_ANON_KEY?:string;SUPABASE_PUBLISHABLE_KEY?:string;SUPABASE_SERVICE_ROLE_KEY?:string;SUPABASE_SECRET_KEY?:string};
export type SharedStoreConfig={url:string;publicKey:string;serverKey:string};
export type SharedStoreCommit={p_auth_user_id:string;p_location_id:string;p_actor_id:string;p_membership_revision:number;p_workspace_revision:number;p_request_id:string;p_fingerprint:string;p_action:string;p_record_id:string;p_records:WorkRecord[];p_at:string};
export type SharedStoreReceipt=CommandResult|null;

