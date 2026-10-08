'use client';
import {useState} from 'react';
import catalog from '../shared/gap-decisions.json';
import './operations.css';
export function BuildGaps(){
 const [query,setQuery]=useState('');
 return <section className="ops-page"><p className="ops-eyebrow">JMAX · Build progress</p><h1>Decisions and remaining work</h1><p>Jay’s September 28 handoff is preserved below. Its “Built” labels describe the source prototype; they do not certify this connected app or its deployment.</p><div className="ops-callout">Manager Log and one-on-ones now have connected code in this build. Production rollout, Supabase connection, external alerts and Jeff’s live-data import remain separate work. Compliance statements below are source claims awaiting review.</div><p className="ops-source"><a href={catalog.source} target="_blank" rel="noreferrer">Read the source handoff</a></p><label className="shared-field">Find a decision<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Prep, deposits, Tuesday, training…"/></label>{catalog.groups.map(group=>{const items=group.items.filter(i=>`${group.name} ${i.title} ${i.note}`.toLowerCase().includes(query.toLowerCase()));return items.length?<div key={group.name}><h2>{group.name}</h2>{items.map(item=><article className="ops-card" key={item.title}><div className="shared-heading"><h3>{item.title}</h3><span className="ops-badge">Source: {item.sourceStatus}</span></div><p>{item.note}</p></article>)}</div>:null})}</section>;
}
