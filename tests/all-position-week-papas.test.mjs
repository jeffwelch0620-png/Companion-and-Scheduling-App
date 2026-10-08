import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {confirmedDutyCatalog} from '../.sites-runtime/shared/starter-tasks.mjs';
import {runPositionWeek} from './all-position-week-fixture.mjs';

const receipts=[];
const source='Owner-confirmed Papa’s walkthrough; JMAX-Position-Review-and-Remaining-Gaps-2026-10-07.md. Fictional test assignment, not a newly approved operating policy.';
const counter=confirmedDutyCatalog.find(r=>r.id==='counter-papa');
const driver=confirmedDutyCatalog.find(r=>r.id==='driver-papa');
const make=confirmedDutyCatalog.find(r=>r.id==='pizza-make-close');
const scenario=(title,detail,nextAction)=>({title,detail,nextAction});
const profiles=[
 {id:'papa-counter',restaurant:'papa',position:'Counter',area:'FOH',source,shiftStartHour:15,shiftEndHour:23,...Object.fromEntries(['opening','service','closing'].map(k=>[k,[...counter[k]]])),dailyScenarios:[
  scenario('In-person guest while phone rings','A phone call arrives while an employee serves a guest at the counter.','Prioritize the guest in front of you and politely ask the phone guest to wait.'),
  scenario('Missing cold item at pickup','The ticket lists a cold item absent from the assembled hot food.','Bring hot and cold items together and correct the ticket mismatch before handoff.'),
  scenario('Payment not confirmed','A fictional pickup has a complete bag but no verified payment status.','Confirm payment before handoff; chat and a checklist do not collect money.'),
  scenario('Opening dressing backup short','No pre-portioned dressing backup was prepared overnight.','Count ready cups and prepare the needed opening portions; no salad-bar assignment belongs here.'),
  scenario('Hot box or soda setup concern','One hot box or a soda component is not ready.','Notify the on-duty manager and use the approved equipment procedure; do not invent a temperature or repair.'),
  scenario('Outdoor tables and glass left dirty','The inspection finds one of the seven outdoor tables uncleared.','Finish the outdoor assignment and request another independent check.'),
  scenario('Cash drawer variance at close','The employee counts the drawer and needs GM review.','Hand the drawer to the GM for restricted verification; turn off both hot boxes and finish the soda close.')],gaps:[
  'Ticket composition, payment confirmation and cash drawer amounts are represented by source-labelled tasks; no live Toast payment or drawer-reconciliation event is exercised.',
  'Equipment shutdown and physical sanitation require a real manager observation; the simulation checks only the recorded review chain.']},
 {id:'papa-delivery-driver',restaurant:'papa',position:'Delivery Driver',area:'FOH',source,shiftStartHour:15,shiftEndHour:23,...Object.fromEntries(['opening','service','closing'].map(k=>[k,[...driver[k]]])),dailyScenarios:[
  scenario('Shipday assignment not visible','The delivery assignment is not visible in the driver’s app.','Check Shipday and contact the restaurant; do not invent an assignment or address.'),
  scenario('Missing item before departure','The delivery ticket and packaged order do not match.','Have the restaurant correct the complete order before departure.'),
  scenario('Nearby delivery still preparing','A second fictional delivery on the same road is not ready.','Use judgment with the restaurant on whether to combine the trip; preserve guest timing rather than wait indefinitely.'),
  scenario('Guest cannot be reached','Calling the guest does not resolve an incomplete delivery.','Contact the restaurant for direction; do not mark delivery completed or abandon food automatically.'),
  scenario('Fuel or vehicle condition concern','The opening vehicle check finds inadequate fuel or a vehicle problem.','Resolve the concern with the restaurant before leaving; no unsafe trip or fabricated departure.'),
  scenario('Prepaid order questioned','A fictional guest asks whether payment should be collected at the doorstep.','All delivery orders are prepaid; do not collect the order payment again.'),
  scenario('Delivery slip missing at payout','A delivery slip is missing before the GM payout review.','Report the missing slip, clean the staging area, help FOH as needed and obtain the GM’s payout direction.')],gaps:[
  'Shipday assignment import, route grouping, address validation, proof of delivery and actual prepaid payment status are not connected by these generic work handlers.',
  'Slips and payout are manager-follow-up instructions; the simulation does not execute a real financial payout.']},
 {id:'papa-pizza-make',restaurant:'papa',position:'Pizza Make',area:'BOH',source,shiftStartHour:15,shiftEndHour:23,...Object.fromEntries(['opening','service','closing'].map(k=>[k,[...make[k]]])),dailyScenarios:[
  scenario('Topping modifier differs from ticket','A fictional pizza modifier needs clarification before assembly.','Read the ticket, use the approved build recipe and clarify the modifier; never guess.'),
  scenario('Dough or topping stock short','A required item is short during service.','Tell the kitchen manager and coordinate the next action; do not silently substitute.'),
  scenario('Make and Catch workload uneven','One person is free while the other stretches and sauces with a backlog.','Flex the teamwork around order flow without a rigid dough-only handoff.'),
  scenario('Required recipe unavailable','The employee cannot find an approved recipe for a build.','Ask the lead for the source recipe; missing Jeff content is not permission to invent portions.'),
  scenario('Late pizza during pizza-table close','A late order arrives while the make table is being broken down.','Coordinate safe continued service with the manager and remaining pizza staff before finishing the close.'),
  scenario('Pizza table inspection fails','The independent checker finds unfinished pizza-table cleanup.','Correct the table, restore ingredients by the approved method and request another check.'),
  scenario('Final oven coverage decision','The remaining pizza employee and manager settle who will cover the final pizza and shutdown.','Keep final ticket coverage explicit; apply the local approved shutdown and crumb-tray instruction.')],gaps:[
  'The source-labelled approved training fixture is not a hosted Jeff recipe pull. Actual dough, build portions and shelf-life specifications must come from current approved recipe content.',
  'Ticket status, pizza assembly and oven operation are not domain events in the generic work/task API; saved checklists do not prove food execution.']},
 {id:'papa-pizza-catch',restaurant:'papa',position:'Pizza Catch',area:'BOH',source,shiftStartHour:15,shiftEndHour:23,opening:[...make.opening],service:['Check each pizza against its ticket, cut it, add required garnish and use the correct box or service platter.','Coordinate timing with Pizza Make and the manager; flexible teamwork follows the order flow.'],closing:['Finish or explicitly pass remaining oven tickets to the manager or remaining pizza employee.','Clean assigned cutting utensils and service area, restock boxes and service trays, and request the assigned closing check.','Do not copy Rudd’s walk-in cooler, freezer or back-hallway cleaning assignment into Papa’s automatically.'],dailyScenarios:[
  scenario('Wrong box or tray','A fictional order has the wrong service package.','Check the ticket and put the order in the correct box or on the correct platter.'),
  scenario('Required garnish missing','An outgoing pizza lacks its ticket-required garnish.','Correct the garnish and have the order checked before sending it.'),
  scenario('Pizza quality concern','The employee notices a quality concern before cutting.','Raise it to the lead for an approved correction or remake; do not invent a safe cooking threshold.'),
  scenario('Ticket and pizza do not match','A pizza arriving at Catch differs from the requested toppings.','Coordinate correction with Make and the manager before handoff.'),
  scenario('Counter requests missing order','A pickup is waiting but the matching pizza is not ready.','Clarify status with Make and Counter instead of inventing readiness.'),
  scenario('Cutting-area inspection fails','The independent checker finds the cutting area or utensils not ready for opening.','Finish the assigned cleanup and request another independent inspection.'),
  scenario('Catch leaves before final pizza','The Catch employee is released while a late pizza still requires coverage.','Name the remaining pizza employee or manager before leaving; no implicit orphaned ticket.')],gaps:[
  'Cutting, garnish, packaging and late-ticket transfer are described in assigned source tasks; there is no demonstrated live POS ticket transfer or physical-quality verification.',
  'Papa’s station-specific detailed Catch closing method is not established by Rudd’s assigned-area list. The fixture does not import Rudd’s cooler/freezer/back-hallway duties.']},
 {id:'papa-shared-dish',restaurant:'papa',position:'Pizza Make',assignment:'Shared dish duties',area:'BOH',source,shiftStartHour:15,shiftEndHour:23,opening:['Put away pizza pans that were left to air-dry overnight.','Coordinate shared dish coverage with the on-duty manager; Papa’s has no dedicated Dishwasher position.'],service:['Share dish work as assigned alongside pizza duties; raise shortages, equipment concerns and workload conflicts to the manager.'],closing:['Complete assigned shared dish cleanup and request a manager check.','Leave cleaned pizza pans to air-dry overnight by the approved local procedure; carry their put-away assignment to the next opening.'],dailyScenarios:[
  scenario('Clean pans still air-drying','The closing employee leaves cleaned pans drying for tomorrow.','Save the explicit next-opening put-away instruction without pretending pans are already stored.'),
  scenario('Opening pan put-away','The previous-night pan task is still saved after reopening the database.','Put away the ready pans and have the next-opening task checked.'),
  scenario('Dish backlog conflicts with pizza demand','Shared dish work backs up while pizzas need attention.','Ask the manager to rebalance help; retain dish responsibility instead of inventing an extra Dishwasher shift.'),
  scenario('Dish equipment concern','A dish-machine or tool issue interrupts assigned work.','Ask the manager for the approved equipment method; no guessed chemical or temperature.'),
  scenario('Pizza pans unavailable mid-service','Pans are not ready for the next pizza.','Coordinate shared dish help and approved handling with the manager.'),
  scenario('Shared dish cleanup fails inspection','An assigned dish-area surface fails the independent check.','Correct the specific unfinished work and request another check.'),
  scenario('Final overnight pan handoff','The final night has a new air-dry and next-opening put-away obligation.','Keep the next-opening work persisted and visible after final database reopening.')],gaps:[
  'Shared dish is an assignment on an existing Papa’s BOH position, not a fabricated dedicated Dishwasher or AM/PM staffing cycle.',
  'Physical drying, equipment sanitation and pan condition require the approved method and real observation; source ownership and stored carryover are what this simulation establishes.']},
];
// Owners described this at all three restaurants. It is recorded as their
// current routine, not a new chemical/sanitation efficacy determination.
profiles[0].closing.push('Break down the soda machine and leave the nozzles in soda water overnight as owners described; use the separately approved equipment-cleaning procedure.');

for(const profile of profiles){
 let pans;
 profile.dailyScenarios=profile.dailyScenarios.map((s,index)=>({...s,run:async({command,view,find,day})=>{
  const w=await view('worker');
  assert.equal(w.location.id,'papa');
  assert.equal(w.me.position,profile.position);
  const savedOpening=w.records.find(r=>r.kind==='task'&&r.data.title===`Day ${day.day} opening`);
  assert.ok(savedOpening);assert.equal(savedOpening.data.detail,profile.opening.join('\n'));
  const shifts=w.records.filter(r=>r.kind==='shift'&&r.ownerId==='worker');
  const currentShift=shifts.find(r=>r.data.start.slice(0,10)===day.businessDate);
  assert.ok(currentShift,'One shift is published for this business date');
  assert.equal(new Date(currentShift.data.start).getUTCHours(),19,'Papa opening is 3 PM Eastern in the simulated October week');
  assert.equal(new Date(currentShift.data.end).getUTCHours(),3,'Fictional 11 PM close ends this single shift');
  const guide=w.records.find(r=>r.kind==='standard'&&r.data.status==='approved'&&r.data.position===profile.position);
  assert.ok(guide);assert.deepEqual(guide.data.criteria,profile.closing);
  assert.ok(!JSON.stringify(profile).includes('Server Station close'));
  if(profile.id==='papa-shared-dish'){
   if(index>0){assert.equal(find(pans.recordId).data.phase,'open');pans=await command('worker','task.transition',{step:'ready',note:'Previous-night pans put away at opening in simulation'},pans);pans=await command('manager','task.transition',{step:'verify',note:'Independent next-opening pan check'},pans);assert.equal(find(pans.recordId).data.phase,'closed');}
   pans=await command('manager','task.create',{ownerId:'worker',title:`Night ${day.day} pans air-dry; next opening put away`,detail:'Papa’s shared dish close: leave cleaned pizza pans air-drying overnight; put away at the following opening using the approved local method.',kind:'task',due:new Date(Date.now()+86400000).toISOString()});
   assert.ok((await view('worker')).records.some(r=>r.id===pans.recordId&&r.data.phase==='open'));
  }
 }}));
 test(`${profile.id}: seven complete durable source-backed shift scenarios`,async()=>{
  const result=await runPositionWeek(profile);result.assignment=profile.assignment??null;result.gaps.push(...profile.gaps.map(detail=>({area:'Position-specific coverage limit',detail})));
  receipts.push(result);fs.mkdirSync('evidence/all-position-week',{recursive:true});fs.writeFileSync(`evidence/all-position-week/papas-${profile.id}.json`,JSON.stringify(result,null,2)+'\n');
  assert.equal(result.days.length,7);assert.equal(result.operationalReseeds,0);assert.equal(result.finalReopen,true);assert.equal(result.aiContextRequests,7);assert.deepEqual(result.failures,[]);
 });
}

test.after(()=>{fs.mkdirSync('evidence/all-position-week',{recursive:true});fs.writeFileSync('evidence/all-position-week/papas-summary.json',JSON.stringify({restaurant:'papa',source,positions:['Counter','Delivery Driver','Pizza Make','Pizza Catch'],sharedAssignments:['Shared dish duties (Pizza Make fixture; not a dedicated Dishwasher)'],outsideThisAgent:['GM and management are covered by the root simulation'],notApplicable:['Server','Host','Salad Bar','Back Window','Dedicated Dishwasher','AM-to-PM shift change'],daysPerProfile:7,profileCount:profiles.length,simulatedProfileDays:receipts.reduce((n,r)=>n+r.days.length,0),results:receipts},null,2)+'\n');});

