'use client';
import {useState} from 'react';
import {personName,type Workspace,type RecordOf} from '../shared/types';
import {equipmentOwner,equipmentReader,type EquipmentFacts} from '../shared/equipment';
import {displayTime} from '../shared/local-time';
import type {Send} from './workspace';
function Field({name,children}:{name:string;children:React.ReactNode}){return <label className="shared-field">{name}{children}</label>}
export function EquipmentFields({d}:{d?:EquipmentFacts}){return <>
 <Field name="Restaurant asset tag"><input name="assetTag" defaultValue={d?.assetTag} maxLength={100} required readOnly={!!d} placeholder="Unique tag for this physical asset"/></Field>
 <Field name="Equipment name"><input name="title" defaultValue={d?.title} maxLength={200} required/></Field>
 <Field name="Physical location"><input name="placement" defaultValue={d?.placement} maxLength={300} required/></Field>
 {(['manufacturer','model','serial'] as const).map(k=><Field key={k} name={({manufacturer:'Manufacturer',model:'Model',serial:'Serial number'})[k]+' · optional'}><input name={k} defaultValue={d?.[k]} maxLength={200}/></Field>)}
 <p>Leave unknown identifiers blank. A replacement is a different physical asset and needs a new entry and tag.</p>
 <Field name="Checked equipment source"><textarea name="sourceRef" defaultValue={d?.sourceRef} maxLength={2000} required placeholder="Checked label, asset list or equipment document, and where it is kept"/></Field>
 <Field name="Equipment notes · optional"><textarea name="details" defaultValue={d?.details} maxLength={2000}/></Field>
 <Field name="Source check or reason"><textarea name="note" maxLength={2000} required/></Field>
 <label><input type="checkbox" name="checked" required/> I checked this physical asset against the stated source. This is not a replacement asset.</label>
 </>}
function input(f:FormData){return {...Object.fromEntries(['title','assetTag','placement','manufacturer','model','serial','sourceRef','details','note'].map(k=>[k,f.get(k)])),checked:f.get('checked')==='on'};}
export function EquipmentRegister({w,send,busy}:{w:Workspace;send:Send;busy:boolean}){
 const [creating,setCreating]=useState(false),[selected,setSelected]=useState<string|null>(null),[filter,setFilter]=useState('active');
 const rows=w.records.filter((r):r is RecordOf<'equipment'>=>r.kind==='equipment'&&equipmentReader(r,w.me)),chosen=rows.find(r=>r.id===selected),owner=equipmentOwner(w.me);
 return <section className="ops-card"><h2>Equipment register</h2><p>Checked physical assets in {w.location.name}. A register entry does not establish operating safety or an approved maintenance procedure. Retired entries keep their history. Owners can file older retired equipment through Work history once linked plans no longer need it. Filed asset tags remain reserved.</p>
 {owner&&<button disabled={busy} onClick={()=>{setCreating(!creating);setSelected(null)}}>{creating?'Cancel equipment entry':'Add checked equipment'}</button>}
 {creating&&<form onSubmit={async e=>{e.preventDefault();if(await send('equipment.create',input(new FormData(e.currentTarget))))setCreating(false)}}><fieldset disabled={busy}><EquipmentFields/><p><button>Save checked equipment</button></p></fieldset></form>}
 <Field name="Show equipment"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="active">Active equipment</option>{owner&&<option value="retired">Retired equipment</option>}</select></Field>
 {!rows.some(r=>r.data.status===filter)&&<p>No checked {filter} equipment entered.</p>}
 {rows.filter(r=>r.data.status===filter).sort((a,b)=>a.data.assetTag.localeCompare(b.data.assetTag)).map(r=><p key={r.id}><button disabled={busy} onClick={()=>{setSelected(r.id);setCreating(false)}}>{r.data.assetTag} · {r.data.title}</button> · {r.data.placement}</p>)}
 {chosen&&<EquipmentCard key={chosen.id+':'+chosen.revision} r={chosen} w={w} send={send} busy={busy}/>}
 </section>;
}
export function EquipmentCard({r,w,send,busy,readOnly=false}:{r:RecordOf<'equipment'>;w:Workspace;send:Send;busy:boolean;readOnly?:boolean}){
 const d=r.data,owner=equipmentOwner(w.me),plans=w.records.filter(x=>x.kind==='maintenance'&&x.data.asset?.id===r.id);
 return <article className="ops-card"><h3>{d.assetTag} · {d.title}</h3><p>{d.status} · {d.placement}</p><p>Manufacturer: {d.manufacturer||'Not entered'} · Model: {d.model||'Not entered'} · Serial: {d.serial||'Not entered'}</p><p className="ops-preserve">{d.details}</p><p className="ops-preserve">Checked source: {d.sourceRef}</p><p>Checked by {personName(w,d.checkedBy)} · {displayTime(d.checkedAt,w.location.timezone)}</p>{d.status==='retired'&&<p>Retired: {d.retirementNote}</p>}
 {readOnly&&<p>Filed equipment history is read-only. Restoration keeps this asset retired; an owner must recheck the same physical asset before reactivation.</p>}
 <p>{plans.length} linked plans in this workspace. Filed plans may also retain this asset snapshot. Changing or retiring equipment requires owners to recheck linked active plans before further service is recorded.</p>
 {owner&&!readOnly&&<><details><summary>{d.status==='retired'?'Recheck and reactivate equipment':'Recheck equipment details'}</summary><form onSubmit={async e=>{e.preventDefault();await send('equipment.revise',input(new FormData(e.currentTarget)),r)}}><fieldset disabled={busy}><EquipmentFields d={d}/><button>Save checked equipment revision</button></fieldset></form></details>{d.status==='active'&&<details><summary>Retire equipment</summary><form onSubmit={async e=>{e.preventDefault();await send('equipment.retire',{note:new FormData(e.currentTarget).get('note')},r)}}><fieldset disabled={busy}><Field name="Retirement reason"><textarea name="note" required maxLength={2000}/></Field><p>Linked plans remain visible and due, but further service needs an active checked asset and plan recheck.</p><button>Retire equipment</button></fieldset></form></details>}</>}
 <details><summary>Equipment history ({d.history.length})</summary>{d.history.map((h,i)=><p key={i}>{h.action} · {personName(w,h.actorId)} · {displayTime(h.at,w.location.timezone)} · {h.note}</p>)}{d.versions.map((v,i)=><details key={i}><summary>Prior details · {displayTime(v.at,w.location.timezone)}</summary><p>{v.facts.assetTag} · {v.facts.title} · {v.facts.placement}</p><p>{v.facts.manufacturer} · {v.facts.model} · {v.facts.serial}</p><p className="ops-preserve">{v.facts.sourceRef}</p><p className="ops-preserve">{v.facts.details}</p><p>{v.reason}</p></details>)}</details>
 </article>;
}
