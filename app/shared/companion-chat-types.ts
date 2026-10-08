export type ChatSource = { id:string; revision:number; title:string; kind:string };
export const explanationStyles=['balanced','brief','step-by-step'] as const;
export type ExplanationStyle=typeof explanationStyles[number];
export function readExplanationStyle(value:unknown):ExplanationStyle{return explanationStyles.includes(value as ExplanationStyle)?value as ExplanationStyle:'balanced';}
export type ChatTurn = { id:string; question:string; answer:string; at:string; status:'pending'|'complete'|'failed'; stale:boolean; error:string; sources:ChatSource[]; focus:ChatSource|null };
export type ChatView = { dailyUsage?:{day:string;used:number;limit:number}; conversationId:string; revision:number; configured:boolean; accessChanged:boolean; pending:boolean; turns:ChatTurn[]; full:boolean; explanationStyle:ExplanationStyle };
export type ChatArchive = { id:string; title:string; archivedAt:string; turnCount:number; accessChanged:boolean };
export type ChatHistoryPage = { conversations:ChatArchive[]; nextCursor:string|null };
export type ArchivedChat = ChatArchive & { turns:ChatTurn[] };
