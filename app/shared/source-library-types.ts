export type SourceDocument = {
  id:string; title:string; filename:string; brand:string; locationId:string; locationName:string;
  department:string; stations:string[]; roles:string[]; documentType:string; operationalUse:string[]; assignment:string;
  sourceOwner:string|null; preparedBy:string|null; lastApprovedDate:string|null; approvalEvidence:string|null;
  sourceStatus:'current'|'draft'|'archived'|'unverified'; publicationStatus:'reference_only'|'approved';
  supersededBy:string|null; sourcePath:string; sha256:string; textSha256:string; capturedAt:string;
  relatedVersions:string[]; duplicates:{id:string;kind:string}[]; conflicts:string[]; content:string;
};
export type SourceConflict = {id:string;title:string;detail:string;documentIds:string[];status:'unresolved'|'resolved'};
export type SourceLibrary = {batchId:string;capturedAt:string;scope:string;documents:SourceDocument[];conflicts:SourceConflict[]};
export type SourceLibraryIndex = Omit<SourceLibrary,'documents'> & {documents:Omit<SourceDocument,'content'>[]};

export function sourceCanPublish(document:SourceDocument,conflicts:SourceConflict[]) {
  return document.publicationStatus==='approved'&&document.sourceStatus==='current'
    &&!!document.sourceOwner?.trim()&&/^\d{4}-\d{2}-\d{2}$/.test(document.lastApprovedDate??'')
    &&Number.isFinite(Date.parse(document.lastApprovedDate!))&&new Date(document.lastApprovedDate!).toISOString().slice(0,10)===document.lastApprovedDate
    &&!!document.approvalEvidence?.trim()&&!document.supersededBy
    &&document.conflicts.every(id=>conflicts.some(c=>c.id===id&&c.status==='resolved'));
}
