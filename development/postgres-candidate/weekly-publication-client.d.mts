import type {RecordOf,Workspace} from '../../app/shared/types';
export type PublicationWorkspace=Workspace&{scheduleRevision:number;inputRevision:number};
export type PublicationClosing={id:string;revision:number;due:string;ownerId:string;managerId:string;verifierId:string|null;standardId:string;standardRevision:number;standard:{title:string;version:number;position:string}};
export type PublicationDraft=RecordOf<'shift'>&{closing:PublicationClosing[];closingIssues:{code:string;closeId?:string}[];copiedStaffing:{id:string;revision:number;status:string}[];sourceReviewComplete:boolean};
export type PublicationReview={weekStart:string;locationId:string;actorId:string;workspaceRevision:number;scheduleRevision:number;inputRevision:number;planningReview:string;plannedGapCount:number;drafts:PublicationDraft[];staffing:(RecordOf<'staffing'>&{gaps:{start:string;end:string;required:number;scheduled:number}[]})[]};
export function publishableDrafts(w:Workspace,weekStart:string,now?:string):RecordOf<'shift'>[];
export function loadWeeklyPublicationReview(call:(path:string,input?:unknown)=>Promise<{status:number;body:unknown}>,w:PublicationWorkspace,weekStart:string,selectedIds:string[],now?:string):Promise<PublicationReview>;
export function publicationInput(review:PublicationReview,fields:{confirmed:boolean;note:string;coverageAcknowledged?:boolean;coverageNote?:string}):Record<string,unknown>;
