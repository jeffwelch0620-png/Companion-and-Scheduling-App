import type {Workspace} from '../../app/shared/types';
import type {PublishedShiftRecord} from './published-shift-client.mjs';
export type CoveringChoice={shiftId:string;revision:number;ownerId:string;ownerName:string;start:string;end:string;position:string;area:string};
export type CancellationReview={locationId:string;actorId:string;shiftId:string;revision:number;workspaceRevision:number;canCancel:boolean;blockedReason:string;closing:{id:string;revision:number;zone:string;due:string;phase:string;ownerId:string;standard:{id:string;title:string;version:number;position:string};optionsTruncated:boolean;options:CoveringChoice[]}[]};
export const closingTransferReviewMessage:string;
export function checkedCancellationReview(w:Workspace,record:PublishedShiftRecord,value:unknown):CancellationReview;
export function loadCancellationReview(call:(path:string)=>Promise<{status:number;body:unknown}>,w:Workspace,record:PublishedShiftRecord):Promise<CancellationReview>;
export function cancellationTransferInput(w:Workspace,record:PublishedShiftRecord,review:CancellationReview,selections:Record<string,string>,decision:{confirmed:boolean;note:string}):{note:string;closeTransfers:{closeId:string;closingRevision:number;shiftId:string;expectedRevision:number}[]};
