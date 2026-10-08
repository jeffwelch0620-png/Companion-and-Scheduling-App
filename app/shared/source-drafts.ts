// Server-only: resolve source identities here, never trust browser-supplied source text.
import { sourceLibrary } from './source-library-data';
import { canDraftStandard, type Command, type SourceQuestion, type StandardProvenance, type Workspace } from './types';
import { requireThat, text } from './validation';

export function resolveSourceDraft(w:Workspace,command:Command):StandardProvenance {
  const d=sourceLibrary.documents.find(d=>d.id===command.input.sourceId&&d.locationId===w.location.id);
  requireThat(w.me.position!=='Dishwasher'&&w.me.capabilities.includes('location.manage'),'Only a restaurant owner can bring a private source into training.',403);
  requireThat(d,'This source is not available at this restaurant.',404);
  requireThat(d.roles.some(role=>role!=='Dishwasher'),'Dish material stays in owner reference. Dish uses Schedule and Inbox.');
  const area=text(command.input.area,'Department',100);
  requireThat(canDraftStandard(w.me,area),'You cannot draft training for this department.',403);
  requireThat(command.input.sourceHash===d.sha256,'The source changed. Open it again before drafting.',409);
  requireThat(d.sourceStatus!=='archived'&&!d.supersededBy,'This source has been replaced or archived. Review its replacement first.');
  const questions:SourceQuestion[]=[
    {id:'scope',prompt:`Confirm which parts apply to ${w.location.name}, this department and station. Identify anything excluded from this guide.`},
    {id:'authority',prompt:'Who owns the original procedure, when was it last approved, and what confirms it is still current? If that cannot be established, explain the current restaurant evidence used to replace it.'},
    ...sourceLibrary.conflicts.filter(c=>d.conflicts.includes(c.id)).map(c=>({id:c.id,prompt:c.title+': '+c.detail+' Record the decision for this guide and where it is reflected in the instructions.'})),
    ...(d.duplicates.length||d.relatedVersions.length?[{id:'versions',prompt:'Review the duplicate and related versions. Identify which instructions this guide uses, what is excluded, and why. Approval applies only to this guide; the original sources remain reference material.'}]:[])
  ];
  return {sourceId:d.id,sourceRevision:1,restaurant:d.locationName,sourceDate:d.capturedAt,attribution:'OneDrive source intake. The original approval is unverified; this guide requires a separate restaurant review.',references:[{title:d.title,section:d.documentType,excerpt:'Original text is retained in the owner source library. Only reviewed instructions written into this guide become employee guidance.',sha256:d.sha256}],questions,answers:{},importedBy:w.me.id,importedAt:'',intake:{batchId:sourceLibrary.batchId,documentId:d.id,title:d.title,sha256:d.sha256,textSha256:d.textSha256,capturedAt:d.capturedAt,sourceStatus:d.sourceStatus,sourceOwner:d.sourceOwner,lastApprovedDate:d.lastApprovedDate,department:d.department,stations:d.stations,roles:d.roles,operationalUse:d.operationalUse,relatedVersions:d.relatedVersions,duplicateIds:d.duplicates.map(x=>x.id)}};
}
