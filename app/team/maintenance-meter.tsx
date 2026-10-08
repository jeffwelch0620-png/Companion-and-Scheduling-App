'use client';
import {useState} from 'react';
import {personName,type RecordOf,type Workspace} from '../shared/types';
import {meterSchedule,meterTiming,maxMeterHours,type MeterRule} from '../shared/maintenance-meter';
import {localDate,displayTime} from '../shared/local-time';
import type {Send} from './workspace';

export function MeterRuleFields({rule,requiredOnly=false}:{rule?:MeterRule;requiredOnly?:boolean}){
 const [enabled,setEnabled]=useState(!!rule);
 return <section><h3>Equipment meter hours{requiredOnly?'':' · optional'}</h3>{requiredOnly?<><input type="hidden" name="meterEnabled" value="on"/><p>The checked source requires service by meter hours alone. No calendar due date is created.</p></>:<><label><input type="checkbox" name="meterEnabled" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> The checked source also requires service by meter hours.</label><p>The calendar rule stays in place. Use this only when the same task has both date and hour limits. Choose Meter hours only above if the source has no date limit. Reset/replacement and telemetry workflows are separate; no meter readings are inferred.</p></>}{(requiredOnly||enabled)&&<>
 <label className="shared-field">Meter identity and source reference<input name="meterRef" maxLength={500} defaultValue={rule?.meterRef} required placeholder="Exact meter, unit and source section"/></label>
 <label className="shared-field">First service due at this meter reading · hours<input type="number" name="initialDueHours" min="0" max={maxMeterHours} step="any" defaultValue={rule?.initialDueHours} required/></label>
 <label className="shared-field">Hours after completed service<input type="number" name="intervalHours" min="0" max={maxMeterHours} step="any" defaultValue={rule?.intervalHours} required/></label>
 <label className="shared-field">Warning window · hours<input type="number" name="warningHours" min="0" max={maxMeterHours} step="any" defaultValue={rule?.warningHours} required/></label>
 <p>Link checked equipment above and enter the actual source thresholds. The first threshold and interval must be positive. Once readings or service exist, a different rule needs a separate checked plan.</p>
 </>}</section>;
}
export function MeterStatus({r}:{r:RecordOf<'maintenance'>}){
 const s=meterSchedule(r.data);if(!s)return null;
 return <div className="ops-callout"><p><strong>Meter status: {s.state} · service due at {s.dueHours} hours</strong></p>{s.reading?<p>Last recorded reading: {s.reading.hours} hours on {s.reading.date}. {s.remaining!==null&&s.remaining>0?`${s.remaining.toLocaleString(undefined,{maximumFractionDigits:6})} recorded hours before due.`:'Recorded threshold reached.'}</p>:<p>No actual meter reading recorded. Hour-based service status cannot be established.</p>}<p>Status uses the last recorded reading only; it is not a live meter check. {r.data.meterOnly?'This plan has no calendar due date.':'Calendar due dates stay separate.'}</p></div>;
}
export function MaintenanceMeterPanel({r,w,send,busy,canRecord,owner,readOnly=false}:{r:RecordOf<'maintenance'>;w:Workspace;send:Send;busy:boolean;canRecord:boolean;owner:boolean;readOnly?:boolean}){
 const [checked,setChecked]=useState(false),d=r.data;if(!d.meter)return null;
 const today=localDate(new Date().toISOString(),w.location.timezone);
 return <section><h3>Meter readings</h3><p>{meterTiming(d.meter)}</p><MeterStatus r={r}/>
 {canRecord&&!readOnly&&<details><summary>Record actual meter reading</summary><form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(await send('maintenance.meter',{date:f.get('date'),hours:Number(f.get('hours')),evidence:f.get('evidence'),note:f.get('note'),checked},r))setChecked(false)}}><fieldset disabled={busy}>
 <label className="shared-field">Actual reading date<input type="date" name="date" max={today} required onChange={()=>setChecked(false)}/></label>
 <label className="shared-field">Actual meter hours<input type="number" name="hours" min="0" max={maxMeterHours} step="any" required onChange={()=>setChecked(false)}/></label>
 <label className="shared-field">Reading evidence<textarea name="evidence" maxLength={2000} required onChange={()=>setChecked(false)} placeholder="Where the dated meter observation can be checked"/></label>
 <label className="shared-field">Evidence or reason<textarea name="note" maxLength={2000} required onChange={()=>setChecked(false)}/></label>
 <p>Readings must be in date order and may not decrease. Correct a mistaken entry first. A meter reset or replacement needs a separate owner-checked plan.</p><label><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} required/> I checked the actual reading from this equipment meter.</label><p><button disabled={!checked}>Save meter reading</button></p>
 </fieldset></form></details>}
 {(d.meterReadings??[]).slice().reverse().map(entry=><article className="ops-card" key={entry.id}><h4>{entry.date} · {entry.hours} hours{entry.voided?' · Voided reading':''}</h4><p className="ops-preserve">{entry.evidence}</p><p className="ops-preserve">{entry.note}</p><p>{personName(w,entry.by)} · {displayTime(entry.at,w.location.timezone)}</p>{entry.plan.meter&&<p>{meterTiming(entry.plan.meter)}</p>}{entry.plan.asset&&<p>Retained asset: {entry.plan.asset.facts.assetTag} · {entry.plan.asset.facts.serial||'Serial not entered'}</p>}
 {entry.voided?<p>Correction: {entry.voided.reason} · {personName(w,entry.voided.by)} · {displayTime(entry.voided.at,w.location.timezone)}</p>:owner&&!readOnly&&(d.services.some(s=>!s.voided&&s.meter?.id===entry.id)?<p>This reading supports completed service. An incorrect service entry must be voided before this reading can be corrected.</p>:<details><summary>Void incorrect meter reading</summary><form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('maintenance.meter-void',{readingId:entry.id,note:f.get('note'),confirmed:f.get('confirmed')==='on'},r)}}><fieldset disabled={busy}><label className="shared-field">Correction reason<textarea name="note" maxLength={2000} required/></label><label><input name="confirmed" type="checkbox" required/> Void this reading and retain the original evidence.</label><p><button>Void meter reading</button></p></fieldset></form></details>)}
 </article>)}
 </section>;
}
