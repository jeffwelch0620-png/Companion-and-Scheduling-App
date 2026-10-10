import type {RecordOf,Workspace} from '../../app/shared/types';
export type PublicationClosing={id:string;revision:number;due:string;ownerId:string;managerId:string;verifierId:string|null;standard:{title:string;version:number;verification:string}};
export type PublicationDraft=RecordOf<'shift'>&{closing:PublicationClosing[];closingIssues:{code:string;closeId?:string}[];copiedStaffing:{id:string;revision:number;status:string}[];sourceReviewComplete:boolean};
export type PublicationReview={weekStart:string;locationId:string;actorId:string;workspaceRevision:number;planningReview:string;plannedGapCount:number;drafts:PublicationDraft[];staffing:(RecordOf<'staffing'>&{gaps:{start:string;end:string;required:number;scheduled:number}[]})[]};
export function publishableDrafts(w:Workspace,weekStart:string,now?:string):RecordOf<'shift'>[];
export function loadWeeklyPublicationReview(call:(path:string,input?:unknown)=>Promise<{status:number;body:unknown}>,w:Workspace,weekStart:string,selectedIds:string[],now?:string):Promise<PublicationReview>;
export function publicationInput(review:PublicationReview,fields:{confirmed:boolean;note:string;coverageAcknowledged?:boolean;coverageNote?:string}):Record<string,unknown>;
