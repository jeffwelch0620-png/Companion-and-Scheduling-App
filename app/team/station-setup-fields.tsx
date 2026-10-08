'use client';
import { canScheduleJob, manages, type RecordOf, type StationSetup, type Workspace } from '../shared/types';
import { canonicalJobRole } from '../shared/job-role';
export const emptyStationSetup=():StationSetup=>({jobs:[],memberIds:[],allJobMembers:true,standardIds:[],managerId:'',goals:[]});
export function StationSetupFields({w,area,value,onChange}:{w:Workspace;area:string;value:StationSetup;onChange:(value:StationSetup)=>void}) {
  const people=w.members.filter(m=>m.area===area&&canonicalJobRole(m.position)!=='Dishwasher');
  const jobs=[...new Set(people.flatMap(m=>[...m.scheduleJobs??[],...m.qualifications]))].filter(j=>canonicalJobRole(j)!=='Dishwasher').sort();
  const eligible=people.filter(m=>value.jobs.some(job=>canScheduleJob(m,job)));
  const guides=w.records.filter((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.area===area&&r.data.status!=='retired');
  const toggle=(key:'jobs'|'memberIds'|'standardIds',id:string,checked:boolean)=>{
    const selected=checked?[...value[key],id]:value[key].filter(x=>x!==id);let next={...value,[key]:selected};
    if(key==='jobs')next={...next,memberIds:next.memberIds.filter(id=>people.some(m=>m.id===id&&selected.some(job=>canScheduleJob(m,job))))};
    // Keep a goal's source until the manager deliberately changes it. Removing
    // a draft guide must not silently turn its goal into an unlinked live goal.
    onChange(next);
  };
  return <div className="station-setup-fields">
    <h3>Scheduling jobs</h3><p>Keep the existing job, such as Cook, and choose this station within it.</p>
    {jobs.map(job=><label className="shared-check" key={job}><input type="checkbox" checked={value.jobs.includes(job)} onChange={e=>toggle('jobs',job,e.target.checked)}/>{job}</label>)}
    {value.jobs.filter(job=>!jobs.includes(job)).map(job=><label className="shared-check" key={job}><input type="checkbox" checked onChange={()=>toggle('jobs',job,false)}/>{job} · no current employees</label>)}
    {!jobs.length&&<p>No scheduling jobs are available in this department yet.</p>}
    <h3>Who can be scheduled here?</h3><p>Availability follows the main job: Cook gets cooking stations; Host gets host stations. This does not mark anyone qualified or change their access.</p>
    <label className="shared-check"><input type="checkbox" checked={value.allJobMembers===true} onChange={e=>onChange({...value,allJobMembers:e.target.checked})}/>Everyone with the selected jobs, including future hires</label>
    {!value.allJobMembers&&eligible.map(m=><label className="shared-check" key={m.id}><input type="checkbox" checked={value.memberIds.includes(m.id)} onChange={e=>toggle('memberIds',m.id,e.target.checked)}/>{m.name}</label>)}
    {!eligible.length&&<p>Choose a scheduling job to see its employees.</p>}
    {value.memberIds.filter(id=>!eligible.some(m=>m.id===id)).map(id=><p key={id}>A previously selected employee no longer matches this station. <button type="button" onClick={()=>toggle('memberIds',id,false)}>Remove unavailable employee</button></p>)}
    <h3>Station training</h3><p>Link the guides for this station. Drafts stay private until approved; employees only receive approved instructions.</p>
    {guides.map(g=><label className="shared-check" key={g.id}><input type="checkbox" checked={value.standardIds.includes(g.id)} onChange={e=>toggle('standardIds',g.id,e.target.checked)}/>{g.data.title} · {g.data.status==='approved'?'Approved':'Draft — review needed'}</label>)}
    {value.standardIds.filter(id=>!guides.some(g=>g.id===id)).map(id=><p key={id}>A linked guide is no longer available. <button type="button" onClick={()=>toggle('standardIds',id,false)}>Remove unavailable guide</button></p>)}
    <h3>Goals when first scheduled</h3><p>Publishing the first shift proposes these goals once per employee. Employees review them in Training; the named manager reviews their progress. Choose a different reviewer when scheduling that manager for their own learning. Repeating a week does not repeat a goal.</p>
    {!!value.goals.length&&<label className="shared-field">Station learning reviewer<select value={value.managerId} required onChange={e=>onChange({...value,managerId:e.target.value})}><option value="">Choose a manager</option>{w.members.filter(m=>manages(m,area,'people.manage')&&m.position!=='Dishwasher'&&(value.allJobMembers||!value.memberIds.includes(m.id))).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
    {value.goals.map((g,i)=>{const update=(patch:Partial<typeof g>)=>onChange({...value,goals:value.goals.map(other=>other.id===g.id?{...g,...patch}:other)});return <fieldset key={g.id}><legend>Station goal {i+1}</legend><label className="shared-field">Goal title<input value={g.title} required maxLength={200} onChange={e=>update({title:e.target.value})}/></label><label className="shared-field">What the employee should demonstrate<textarea value={g.definition} required maxLength={2000} onChange={e=>update({definition:e.target.value})}/></label><label className="shared-field">Days after the first scheduled shift<input type="number" min={1} max={90} value={g.dueDays} required onChange={e=>update({dueDays:Number(e.target.value)})}/></label><label className="shared-field">Guide for this goal<select value={g.standardId??''} onChange={e=>update({standardId:e.target.value||undefined})}><option value="">No guide linked</option>{g.standardId&&!value.standardIds.includes(g.standardId)&&<option value={g.standardId}>Guide removed — choose a guide or remove this goal</option>}{guides.filter(s=>value.standardIds.includes(s.id)).map(s=><option key={s.id} value={s.id}>{s.data.title} · {s.data.status}</option>)}</select></label>{g.standardId&&guides.some(s=>s.id===g.standardId&&s.data.status!=='approved')&&<p>This goal waits for guide approval. It will be proposed on a later published station shift once the guide is approved.</p>}<button type="button" onClick={()=>onChange({...value,goals:value.goals.filter(other=>other.id!==g.id)})}>Remove goal {i+1}</button></fieldset>})}
    <button type="button" disabled={value.goals.length>=5} onClick={()=>onChange({...value,goals:[...value.goals,{id:crypto.randomUUID(),title:'',definition:'',dueDays:7}]})}>Add station goal</button>
    {!!value.goals.length&&<p>Editing a template does not rewrite goals already sent. Review existing goals separately; add a new template only for a genuinely new learning outcome.</p>}
  </div>;
}
