import type {Workspace,RecordOf} from '../../app/shared/types';
export type PublishedShiftRecord=RecordOf<'shift'> & {data:RecordOf<'shift'>['data'] & {publishedActions:{canEdit:boolean;canChangeStructure:boolean;canChangeStation:boolean;canCancel:boolean;hasLinkedTasks:boolean;hasCompletedClosing:boolean;unfinishedClosingCount:number;editAreas:string[];blockedReason:string}}};
export const publishedShiftReviewMessage:string;
export function checkedPublishedShift(w:Workspace,r:unknown):PublishedShiftRecord;
export function publishedShiftFields(w:Workspace,r:PublishedShiftRecord):Record<string,string>;
export function publishedShiftInput(w:Workspace,r:PublishedShiftRecord,fields:Record<string,unknown>,confirmed:boolean,now?:string):Record<string,unknown>;
export function publishedShiftCancelInput(w:Workspace,r:PublishedShiftRecord,note:unknown,confirmed:boolean,now?:string):{note:string;closeTransfers:never[]};
