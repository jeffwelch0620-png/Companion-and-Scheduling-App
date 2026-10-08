import './team/workspace.css';
/* eslint-disable @next/next/no-html-link-for-pages -- Full navigation enters the existing authentication gates without a client router. */

export default function CompanionLanding(){
  return <div className="shared-ui"><main className="companion-landing"><a className="shared-brand" href="/"><b>J</b> MAX <span>Restaurant Companion</span></a><h1>A clearer week.<br/>A stronger team.</h1><p>Scheduling, station training and JMAX guidance in one restaurant workspace.</p><div className="shared-actions"><a className="shared-primary" href="/team">Open your workspace</a><a href="/review">Owner review</a></div><p className="shared-muted">Employee workspaces require assigned restaurant access. Owner review uses fictional employees and requires the owner’s account.</p></main></div>;
}
