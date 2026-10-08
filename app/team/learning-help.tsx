'use client';
import {useState} from 'react';
import {chatSource} from '../shared/companion-focus';
import type {RecordOf,Workspace} from '../shared/types';
import {CompanionChat} from './companion-chat';
import {StationGuideContent} from './station-knowledge';

export function LearningHelp({goal,w,apiRoot}:{goal:RecordOf<'goal'>;w:Workspace;apiRoot:string}) {
 const [open,setOpen]=useState(false),[showGuide,setShowGuide]=useState(false);
 const guide=w.records.find((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.id===goal.data.standardId&&r.revision===goal.data.standardRevision&&r.data.status==='approved');
 return <section className="learning-help"><button type="button" className="learning-help-toggle" aria-expanded={open} onClick={()=>setOpen(!open)}><span><strong>Ask JMAX</strong><small>Help with this practice</small></span><span aria-hidden="true">{open?'−':'+'}</span></button>{open&&<div className="shift-context-panel">{showGuide&&guide&&<section><h3>{guide.data.title}</h3><StationGuideContent guide={guide.data.guide} provenance={guide.data.provenance}/><ul>{guide.data.criteria.map((c,i)=><li key={i}>{c}</li>)}</ul><button className="inline-action" onClick={()=>setShowGuide(false)}>Close instructions</button></section>}<CompanionChat learningMode w={w} apiRoot={apiRoot} focus={chatSource(goal)} onOpen={r=>{if(guide&&r.id===guide.id)setShowGuide(true)}}/></div>}</section>;
}
