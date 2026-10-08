import type { ReactNode } from 'react';

export function WorkspaceIcon({ name, size=22 }: {name:string;size?:number}) {
 const paths:Record<string,ReactNode>={
  Home:<><path d="m3 11 9-8 9 8v10h-6v-7H9v7H3Z"/></>,
  Areas:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  Log:<><rect x="4" y="3" width="16" height="19" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  "My day":<><path d="m3 11 9-8 9 8v10h-6v-7H9v7H3Z"/></>,
  More:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  Filter:<><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="white"/><circle cx="16" cy="12" r="2" fill="white"/><circle cx="10" cy="18" r="2" fill="white"/></>,
  Schedule:<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/></>,
  Training:<><path d="m3 7 9-4 9 4-9 4-9-4Zm3 2v7c4 3 8 3 12 0V9m3-2v9"/></>,
  Team:<><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/></>,
  JMAX:<><path d="M20 11V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v11a3 3 0 0 0 3 3h4l4 2v-5"/><path d="m18 11 1.5 3.5L23 16l-3.5 1.5L18 21l-1.5-3.5L13 16l3.5-1.5L18 11ZM7 8h9M7 12h4"/></>,
  Inbox:<><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 13h5l2 3h4l2-3h5"/></>,
  Guide:<><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/></>,
  Review:<><rect x="5" y="4" width="14" height="17" rx="3"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="m9 13 2 2 4-5"/></>,
  Goal:<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
 };
 return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>{paths[name]??paths.Guide}</svg>;
}
