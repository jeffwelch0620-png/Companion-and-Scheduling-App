import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {confirmedDutiesForLocation,confirmedDutySource} from '../.sites-runtime/shared/starter-tasks.mjs';
import {runPositionWeek} from './all-position-week-fixture.mjs';

// Reference content is a fictional QA assignment, not approval of a restaurant SOP.
const references=confirmedDutiesForLocation('rudds');
const reference=id=>{const item=references.find(r=>r.id===id);assert.ok(item,`Missing confirmed reference ${id}`);return item;};
const scenarios=rows=>rows.map(([title,detail,nextAction])=>({title,detail,nextAction}));
const make=(id,position,area,duty,rows,extra={})=>({id:'rudds-'+id,restaurant:'rudds',position,area,opening:[...duty.opening],service:[...duty.service],closing:[...duty.closing],dailyScenarios:scenarios(rows),source:'Owner-confirmed position walkthrough and October 7 position review; fictional QA approval only',provenance:{source:confirmedDutySource,referenceIds:duty.referenceIds??[],kind:'source-backed fictional QA assignment'},...extra});
const sourced=id=>({...reference(id),referenceIds:[id]});
const generic=(opening,service,closing)=>({opening,service,closing});
const managerCaps=['tasks.manage','close.confirm','standards.approve','schedule.manage','schedule.publish','schedule.change','people.manage'];

export const ruddsProfiles=[
 make('server','Server','FOH',{
  ...sourced('server-shared'),closing:[...reference('server-shared').closing,...reference('server-rudds-side-work').closing],referenceIds:['server-shared','server-rudds-side-work']
 },[
  ['Wrong food after delivery','Guest identifies a wrong entrée after delivery.','Report the correction to Expo and the responsible manager and follow it back to the guest.'],
  ['Appetizer timing','Appetizer is still missing when entrées are nearly ready.','Coordinate timing with Expo and keep guests informed.'],
  ['Drink refill while ordering','Another table needs refills while the current table is ready to order.','Arrange help while retaining attentive service and read the food order back.'],
  ['Bathroom close missed','Employee bathroom was omitted during the first close.','Complete the assigned bathroom work and request a physical recheck.'],
  ['Silverware and condiment shortage','Silverware bags and table condiments need attention near checkout.','Finish assigned side work, check condiments and put Love seasoning away.'],
  ['Cut with tables remaining','Manager tells Host no more new tables but existing guests remain.','Finish those tables, side work and server-bank settlement before manager release.'],
  ['Interrupted readiness save','Phone reconnects after close readiness was submitted.','Recover the existing saved close and request independent verification without duplicate work.'],
 ],{goal:'Read orders back, maintain table attention and finish Rudd’s assigned side work.'}),
 make('host','Host','FOH',sourced('host-shared'),[
  ['Server overloaded','Next written-rotation section is overloaded.','Ask the manager for direction before seating the section.'],
  ['Arrivals while away','Guests arrive while Host is seating another party.','Use the waiting sign and nearby staff welcome, then acknowledge guests promptly on return.'],
  ['Several parties arrive','Server and kitchen workload are high while several parties arrive.','Maintain a steady welcoming pace and communicate backups.'],
  ['Written rotation challenged','A server disputes which section should be next.','Refer to the written rotation and ask the manager rather than favoring a server.'],
  ['Unclean booster seat','An assigned booster seat is missed during closing.','Clean it and request independent reinspection.'],
  ['Silverware backlog','Menus and glass are done but silverware bagging has a backlog.','Help bag silverware when needed.'],
  ['Opening inherited issue','The previous shift left a damaged menu issue unresolved.','Recover saved unfinished work and communicate it before using the menus.'],
 ]),
 make('busser','Busser','FOH',sourced('busser-shared'),[
  ['No sanitation towel','Required tub or sanitation towel is not ready.','Check with the manager before substituting an unapproved method.'],
  ['Occupied table','Table has dishes but guests have not left.','Help pre-bus appropriately; do not treat the occupied table as released.'],
  ['Seat missed on reset','Tabletop is clean but a seat remains dirty.','Wipe every seat and push applicable chairs in before signaling readiness.'],
  ['Several tables released','Multiple tables vacate while an entry needs attention.','Float the whole dining room and coordinate priorities with the manager.'],
  ['Trash assignment unfinished','Assigned dish or trash work remains at departure.','Finish assigned detail and inform the responsible manager.'],
  ['Server requests help','A server identifies remaining help during departure check.','Check with all servers, complete agreed help, then check with the manager.'],
  ['Entry reset carried over','An entrance issue remains unfinished from the prior close.','Keep the issue visible until remedy and manager verification.'],
 ],{staffing:'Optional role: simulated when staffed; not a claim of current daily staffing.'}),
 make('food-runner','Food Runner','FOH',sourced('runner-shared'),[
  ['Expo missing supplies','Expo needs restocking at arrival.','Check Expo needs and help prepare the window.'],
  ['Dish destination uncertain','Similar dishes could belong to several guests.','Politely announce the dish, let the guest identify it and place it.'],
  ['Incorrect modifier','Guest reports an incorrect modifier at delivery.','Inform Expo and the responsible server; follow the correction through.'],
  ['Missing plate','One guest has not received their plate.','Bring the missing item to Expo attention and inform the server.'],
  ['Service continues at departure','Food Runner is nearly done but Expo still needs help.','Check with Expo, servers and manager before leaving.'],
  ['Late delivery pending','A final food delivery is still pending as the runner prepares to leave.','Hand off remaining work explicitly rather than silently leaving it.'],
  ['Saved guest correction','Yesterday’s reported correction has no verified resolution.','Recover its saved owner and next action; a chat answer is not completion.'],
 ],{staffing:'Dedicated when busy; servers cover running in slower service.'}),
 make('expo','Expo','FOH',{
  ...sourced('expo-rudds'),opening:['Check pans, lids, cups, appropriate ladles, hot sauces and heat lamps; check practical kitchen readiness.'],service:[...reference('expo-rudds').service,'Check outgoing quality and complete ticket components before release.']
 },[
  ['Cooking error','Cooked item is incorrect before handoff.','Request a recook or remake.'],
  ['Ordering error','Ticket detail is incorrect before release.','Contact the FOH manager for the ordering issue.'],
  ['Incomplete order','A required component is absent at the window.','Communicate timing and missing items before releasing the order.'],
  ['Salad quality issue','Outgoing Salad and Mac Bowls item does not meet the approved quality check.','Keep the correction with the responsible station and verify before release.'],
  ['Late pizza after Catch leaves','A late pizza needs catching after the dedicated Catch employee departs.','Coordinate Expo or manager help with the remaining pizza team.'],
  ['Heat lamp shutdown missed','A heat lamp is still on during closing inspection.','Finish the assigned shutdown and request a recheck.'],
  ['Sauce or paper close missed','Beer cheese, marinara or Alfredo remains out, or paper products are not stocked.','Put the required products away, restock paper and clean the area.'],
 ]),
 make('foh-manager','FOH Manager','FOH',generic(
  ['Read the Red Book, check staffing and assignments, walk readiness and coordinate shortages with BOH for Toast communication.'],
  ['Monitor seating pace and guest recovery; Host and servers communicate during brief table visits.','Coordinate FOH and BOH cuts; support roles normally first when covered, servers last.','Tell Host no more tables for a cut server; finish existing tables before checkout.'],
  ['Check side work and settle server banks before release.','Personally inspect the dining room, bathrooms and entrances.','Complete restaurant-specific cash close and Red Book; hand off unfinished work.']
 ),[
  ['Support call-out','Support coverage is short at opening.','Arrange named coverage and communicate assignments without pretending a proposal is a published schedule.'],
  ['Brief table conversation','Manager is briefly talking with guests while Host sees a backup.','Use ordinary Host/server communication with the manager.'],
  ['Prolonged Expo coverage','FOH Manager has been pulled to Expo for an extended period.','Fix the scheduling or coverage problem so floor oversight resumes.'],
  ['Service slows','Support and kitchen staffing remain high during a slowdown.','Coordinate cuts with BOH; keep covered support duties and servers normally last.'],
  ['Cut server has guests','Cut server has remaining guest tables.','Stop new seating and retain table, side-work and bank responsibilities until checkout.'],
  ['Closing walk fails','Personal walk finds missed bathroom or entrance work.','Return the assignment for correction and physically recheck.'],
  ['Unfinished Red Book item','Maintenance issue remains unresolved at final close.','Keep a named owner and explicit next-shift action.'],
 ],{capabilities:managerCaps}),
 make('dish-am','Dishwasher','BOH',generic(
  ['Check inherited dish readiness, equipment instructions and manager-assigned work for the actual Rudd’s staffing pattern.'],
  ['Coordinate dish flow and communicate missing safe equipment instructions; BOH covers staffing gaps.'],
  ['Clean assigned dish area and communicate unfinished work to the PM team and manager.','Follow the reviewed equipment-specific handoff and obtain manager release.']
 ),[
  ['Inherited backlog','Dish area starts with an unresolved backlog from the previous close.','Check with the manager and retain the inherited unfinished work.'],
  ['Unclear machine method','Equipment instruction needed for a cleaning step is missing.','Stop that step and ask for the equipment-specific approved method.'],
  ['Failed dish inspection','Manager finds remaining residue or missed cleanup.','Correct the assigned work and request reinspection.'],
  ['Sunday coverage','Dedicated Sunday coverage is scheduled in the fictional week.','Follow Rudd’s named duty assignment rather than copying Bert’s AM outside-grounds task.'],
  ['BOH covers a gap','Dish coverage is interrupted while BOH helps.','Communicate outstanding work and retain its ownership and manager check.'],
  ['AM to PM handoff','Remaining dishes must be communicated to the incoming team.','Provide an explicit handoff and check equipment instructions; do not infer a different restaurant’s machine state.'],
  ['Reconnected inbox','Phone reconnects after a dish task readiness save.','Recover the same saved task and manager check without duplicate work.'],
 ],{shiftVariant:'AM',contentGap:'Detailed Rudd’s equipment procedure and current AM staffing assignments are not established by the shared Bert’s dish source.'}),
 make('dish-pm','Dishwasher','BOH',generic(
  ['Check inherited dish work and the assigned Rudd’s PM staffing pattern with the manager.'],
  ['Coordinate loading and catching with the named team and BOH coverage without inventing a new access role.'],
  ['Finish dish area cleanup, report equipment or supply concerns, and request independent manager release.','Use approved equipment-specific closing instructions rather than copying another restaurant’s method.']
 ),[
  ['Incoming dish handoff','AM work remains unfinished on PM arrival.','Read the saved handoff and check with the manager.'],
  ['Missing catch help','Named catch coverage is unavailable during busy service.','Arrange manager-directed BOH help and preserve unfinished work.'],
  ['Inspection fails','Dish cleanup is submitted but a remaining problem is found.','Correct it and request manager reinspection.'],
  ['Sunday coverage','Sunday dish workload needs the described dedicated coverage.','Use the current named Rudd’s assignment and communicate gaps.'],
  ['Equipment concern','Equipment condition prevents a scheduled step.','Report it and obtain safe approved direction rather than improvising repair.'],
  ['Late pans','Pizza pans arrive after initial close readiness.','Retain responsibility for remaining work and request another independent check.'],
  ['Close to next open','One unresolved supply issue must reach tomorrow’s manager.','Keep the saved unfinished issue and explicit next action through checkout.'],
 ],{shiftVariant:'PM'}),
 make('fryer','Fryer','BOH',generic(
  ['Check fryer readiness, clean utensils, station stock and oil condition at opening.'],
  ['Follow current ticket and approved product instructions; coordinate timing with Expo.','Check and report oil condition at midshift; planned filtering or replacement is distinct from completed work.'],
  ['Check oil condition at close, finish ordinary fryer-station cleanup and hand off shortages.','Use reviewed equipment-specific cleaning and request manager check.']
 ),[
  ['Oil condition uncertain','Opening condition cannot be judged under an approved grading scale.','Record the observation and escalate; do not invent grade or replacement criteria.'],
  ['Stock shortage','Required fryer product is short during service.','Notify the kitchen manager and Expo and use manager-directed prep priorities.'],
  ['Missed cleaning','Initial closing inspection finds missed ordinary station cleanup.','Correct and request another independent check.'],
  ['Oil action only planned','An oil-change or filtering action is planned but not completed.','Keep planned action distinct from completion and actual quantities.'],
  ['Midshift deterioration','Oil condition changes during busy service.','Report it for the approved action rather than assuming a scheduled automatic replacement.'],
  ['Unsafe equipment instruction missing','The equipment method is unclear for a requested step.','Pause that step and request the approved equipment instruction.'],
  ['Carryover oil concern','A prior oil concern is still unresolved on arrival.','Recover it and ask the named manager for a decision before treating it as cleared.'],
 ],{procedureGap:'Oil filtering schedule, grade definitions and action criteria are intentionally pending; no threshold is fabricated.'}),
 make('grill','Grill / Flat Top','BOH',generic(
  ['Check station readiness, clean utensils, stock and current approved menu ownership.','Rudd’s station has no Bert’s charbroiler assignment.'],
  ['Follow tickets and approved recipes and doneness methods; coordinate timing with adjacent stations and Expo.'],
  ['Finish station and flat-top cleanup using the approved equipment method.','Store remaining product, report shortages and get the required closing review.']
 ),[
  ['Missing stock','Required stock is low at opening.','Notify BOH manager and prioritize assigned prep.'],
  ['Timing conflict','Adjacent stations have different completion times.','Communicate with Expo to keep the order coordinated.'],
  ['Flat-top cleanup missed','Physical closing inspection finds unfinished station cleanup.','Correct the assigned area and request a recheck.'],
  ['Wrong equipment instruction','A Bert’s charbroiler instruction appears in a Rudd’s request.','Reject the restaurant mismatch and obtain the actual Rudd’s equipment guide.'],
  ['Deep-clean demand','Behind-equipment or hood deep cleaning is requested during busy service.','Separate the planned slower-period assignment from ordinary station close.'],
  ['Specification unclear','A product specification or doneness method is not provided.','Ask the kitchen lead for the approved method; do not invent a temperature.'],
  ['Unresolved maintenance','An earlier equipment issue remains unresolved at opening.','Recover the assigned issue and manager direction before marking the station ready.'],
 ],{alias:'Flat Top is covered as a Grill station assignment; a distinct Rudd’s Flat Top role boundary is unconfirmed.',procedureGap:'Exact hood and behind-equipment deep-clean cadence remains deferred.'}),
 make('pizza-make','Pizza Make','BOH',sourced('pizza-make-close'),[
  ['Build specification missing','A ticket modifier needs a current build instruction that is not available.','Ask for the approved build card; do not guess recipe portions.'],
  ['Uneven workload','Second cook is available while stretching and saucing are backed up.','Flex the teamwork to current order flow rather than require a fixed handoff.'],
  ['Pizza table close incomplete','Pizza-table breakdown misses an assigned area.','Pizza Make owns the close; correct it and request reinspection.'],
  ['Catch employee leaves','Catch has departed but pizza orders remain.','Coordinate with the remaining pizza cook, Expo or manager for late catching.'],
  ['Ingredient shortage','Required topping is short during service.','Notify the manager and Expo and use the current approved substitution decision.'],
  ['Shutdown ownership unclear','The last pizza cook needs to finish oven shutdown and crumb tray.','Use the named remaining pizza assignment and manager direction.'],
  ['Opening inherited issue','Previous close left a reported station shortage.','Recover the saved issue and prepare the station under current manager direction.'],
 ]),
 make('pizza-catch','Pizza Catch','BOH',generic(
  [...reference('pizza-make-close').opening],
  ['Check pizza against the ticket, cut, add required garnish and box or plate for the correct destination.','Coordinate flexibly with Pizza Make, Expo and the manager for late tickets.'],
  ['Clean cutting area and utensils, restock approved garnish bottles, shakers, boxes and service trays.',...reference('catch-rudds').closing]
 ),[
  ['Wrong ticket match','Finished pizza does not match the ticket.','Bring the issue to Pizza Make and Expo before release.'],
  ['Box shortage','Correct box size is short during service.','Restock or ask for the approved handoff arrangement; do not mislabel the order.'],
  ['Walk-in cleanup missed','Assigned walk-in, freezer or back hallway cleanup was missed.','Finish the Rudd’s Catch area and request an independent check.'],
  ['Rush sequence','Several pizzas finish while another needs correction.','Keep each ticket, garnish and destination distinct and communicate the correction.'],
  ['Late pizza coverage','A pizza will finish after planned Catch departure.','Arrange an explicit remaining-cook, Expo or manager handoff.'],
  ['Garnish missing','Required garnish is unavailable before the pizza leaves.','Report it and obtain the approved correction rather than quietly omitting it.'],
  ['Prior issue unresolved','Cutting-area supply concern carries into the next opening.','Recover saved work and obtain manager direction.'],
 ],{referenceIds:['pizza-make-close','catch-rudds']}),
 make('salad-mac','Salad and Mac Bowls','BOH',generic(
  ['Check station stock, backup product, lettuce quality, pans, utensils and measuring tools.'],
  ['Follow current Salad and Mac Bowl instructions and communicate timing with Expo.','Expo checks outgoing quality; the station may combine with Expo or Catch in slower service.'],
  ['Clean and reset the assigned station, store and identify remaining products under the approved method.','Report shortages and unfinished work and request manager review.']
 ),[
  ['Lettuce quality concern','Opening lettuce does not pass the available approved quality guidance.','Tell BOH manager; do not silently use questionable product.'],
  ['Measuring tool missing','Required measuring tool is absent for service.','Ask for the approved tool or method rather than guessing portions.'],
  ['Station cleanup missed','Inspection identifies remaining station work.','Correct it and request a recheck.'],
  ['Expo quality correction','Expo identifies a quality issue before release.','Correct the bowl and follow through with Expo.'],
  ['Combined slower station','Employee also helps Expo or Catch during slower service.','Keep named duties and handoffs clear; the assignment does not widen restaurant access.'],
  ['Backup stock exhausted','Station backup product is exhausted during service.','Report the shortage and use manager-directed prep priorities.'],
  ['Wrong salad-bar duty','A request suggests Bert’s Salad Bar close at Rudd’s.','Reject it: Salad and Mac Bowls is not a salad bar.'],
 ],{contentGap:'Product-specific prep, storage and date procedures require current source-linked recipes; no inferred expiry.'}),
 make('boh-manager','BOH Manager','BOH',generic(
  ['Check staffing, equipment and food readiness, shortages, prep planning and temperature-check responsibilities.'],
  ['Assign who handles an urgent prep shortage and coordinate staffing cuts with FOH.','Coach missed duties initially and escalate continuing problems to GM.','Verify station and cooling checks using the approved procedures.'],
  ['Complete next-day restaurant prep and bulk-prep sheets; retain actual quantities distinct from planning.','Verify station checkout and unresolved shortages; hand off unfinished work.','GM remains ultimately accountable when BOH Manager is absent.']
 ),[
  ['Opening shortage','Readiness walk finds a product shortage.','Assign urgent prep and communicate availability with Expo and FOH.'],
  ['Prep interrupts service','A shortage requires someone to stop current work.','BOH Manager decides the reassignment and keeps order timing communicated.'],
  ['Station inspection fails','Station claims ready but inspection finds unfinished work.','Require correction and recheck before release.'],
  ['Manager absent','GM appoints someone to perform checks while BOH Manager is absent.','Keep GM ultimately responsible and record the actual delegated assignment.'],
  ['Repeated missed duty','The same required stock or check has been missed again.','Coach initially, then bring continuing misses to GM.'],
  ['FOH cuts while busy kitchen','FOH sees a slowdown before BOH tickets are finished.','Coordinate cuts to preserve actual coverage and finish remaining work.'],
  ['Tomorrow prep and bulk','Next-day prep plans need shortages and counts carried forward.','Prepare the restaurant and bulk sheets with source units and named responsibility.'],
 ],{capabilities:managerCaps}),
 make('prep-cook','Prep Cook','BOH',generic(
  ['Read the manager-released assigned daily and bulk prep, current recipe and on-hand count.','Ranch weekly par is six five-gallon vessels per restaurant; Julienne green peppers is one Rudd’s vessel.'],
  ['Follow source recipe instructions and shelf-life guidance; report actual completion quantity and shortage explanations.','Keep planned prep, actual production and inventory changes separate.'],
  ['Report remaining work and shortages to the manager, clean assigned prep area and follow approved product handling.','Retain incomplete assigned prep for next-day follow-through.']
 ),[
  ['Draft prep not released','A draft or another employee’s prep line is not authorized for this employee.','Use only manager-released work actually assigned to the employee.'],
  ['Recipe ingredient unmapped','A source ingredient has no matching current item unit.','Ask for manager source review; do not infer supplier-pack or portion conversion.'],
  ['Prep area inspection fails','A close-ready prep area still needs cleanup.','Correct it and request reinspection.'],
  ['Short actual quantity','Actual production is below the assigned quantity.','Report actual quantity and a shortage explanation; do not change stock twice.'],
  ['Shelf life and burn rate','Stock is just below par but expected use is covered.','Use Jeff’s reviewed usage-based recommendation and shelf-life input, not automatic top-up.'],
  ['Bulk vessel ambiguity','A tub size lacks a verified volume conversion.','Keep the lidded vessel count and request source-unit review instead of inventing gallons.'],
  ['Completed but unresolved shortage','Employee completed the quantity report but the shortage needs manager action.','Keep the reported shortage visible for manager follow-through.'],
 ],{recipeGap:'This role week exercises assigned instruction and follow-through. Dedicated employee-prep API tests cover recipe projection and completion; the week alone does not prove a hosted Jeff pull.'}),
];

// Managers use their own authorized manager-log and shift-summary handlers,
// rather than calling those operations exercised because an issue was described.
for(const profile of ruddsProfiles.filter(p=>p.position==='FOH Manager'||p.position==='BOH Manager')){
 let issue,lastSummary;
 for(const [index,scenario] of profile.dailyScenarios.entries())scenario.run=async({command,view,find,day})=>{
  if(index===0)issue=await command('worker','managerlog.create',{ownerId:'worker',department:profile.area,title:'Named unresolved '+profile.area+' carryover',detail:'Fixture issue with a named manager and next-opening follow-through.',category:profile.area==='BOH'?'Food and prep':'Guest recovery',priority:'routine',due:new Date(Date.now()+86400000).toISOString()});
  else assert.ok((await view('worker')).records.some(r=>r.id===issue.recordId),'Previous manager issue must survive daily reopen.');
  if(index===1)issue=await command('worker','managerlog.accept',{note:'Assigned manager accepts and retains responsibility.'},issue);
  if(index===5)issue=await command('worker','managerlog.resolve',{note:'Manager verifies the reported remedy in this simulation.'},issue);
  if(index===6)issue=await command('worker','managerlog.reopen',{note:'The issue recurs and must carry to the next opening.'},issue);
  assert.equal(find(issue.recordId).data.status,index===5?'resolved':index===0||index===6?'open':'accepted');
  if(lastSummary)assert.equal(find(lastSummary.recordId).data.status,'submitted','Prior daily summary remains submitted.');
  let summary=await command('worker','shiftentry.save',{department:profile.area,businessDate:day.businessDate,shift:'closing',readiness:index===5?'ready':'action-needed',summary:scenario.title+': manager records the observed shift issue.',tomorrowNote:'Named issue remains '+find(issue.recordId).data.status+'; check the actual result at next opening.',issueIds:[issue.recordId]});
  summary=await command('worker','shiftentry.submit',{},summary);
  assert.equal(find(summary.recordId).data.status,'submitted');
  assert.deepEqual(find(summary.recordId).data.issueIds,[issue.recordId]);
  lastSummary=summary;
 };
}

export const ruddsCoverageLimitations=[
 'Each position is stress-tested for seven consecutive fictional days when staffed, not a claim that one actual employee works seven days.',
 'Manager profiles also exercise their own manager-log accept/resolve/reopen and daily submitted shift summaries with linked carryover. Staffing cuts and bank settlement remain scenario text, not proof of real labor or cash actions.',
 'A saved issue and correction workflow does not prove a real POS order, payment, guest meal, table rotation or physically completed sanitation task.',
 'Rudd’s has no salad bar or Back Window role. Bert’s charbroiler, outside-grounds AM Dish task and salad-bar responsibilities are not copied here.',
 'Dishwasher AM/PM are distinct source-backed shift variants, not separate access tiers. Dish AI uses assigned task and guide context; general development goals and broad operations remain outside the current Dish experience.',
 'Grill / Flat Top is the sourced Rudd’s station baseline. A separate Flat Top menu boundary remains unconfirmed; no extra role is fabricated.',
 'Oil grade, filtering and replacement criteria and hood/deep-clean cadence remain intentionally deferred procedure decisions.',
 'Current assigned guides are fictional QA fixtures. Source references are not silently approved or installed as production training.',
 'Dedicated Prep Cook role uses released daily/bulk prep, but generic week messages do not simulate actual recipe production or hosted Food transport.',
];

test('Rudd’s: every sourced position, seven durable days, closing and role-specific curveballs',async()=>{
 fs.mkdirSync('evidence/all-position-week',{recursive:true});
 const results=[];
 for(const profile of ruddsProfiles){
  const result=await runPositionWeek(profile);
  result.profile={id:profile.id,position:profile.position,area:profile.area,shiftVariant:profile.shiftVariant??null,staffing:profile.staffing??null,opening:profile.opening,service:profile.service,closing:profile.closing,provenance:profile.provenance};
  for(const key of ['contentGap','procedureGap','recipeGap','alias'])if(profile[key])result.gaps.push({area:key,detail:profile[key]});
  results.push(result);
  console.log(JSON.stringify({restaurant:'rudds',position:profile.id,days:result.days.length,failures:result.failures.length}));
 }
 fs.writeFileSync('evidence/all-position-week/rudds-results.json',JSON.stringify({restaurant:'rudds',positions:results.length,positionDays:results.reduce((n,r)=>n+r.days.length,0),limitations:ruddsCoverageLimitations,results},null,2)+'\n');
 fs.writeFileSync('evidence/all-position-week/rudds-summary.md',['# Rudd’s seven-day position simulation','Actual handlers and durable local records; fictional data and approvals only.','',...results.map(r=>`- ${r.position}${r.profile.shiftVariant?' '+r.profile.shiftVariant:''}: ${r.days.length} days; ${r.failures.length} failures; ${r.aiContextRequests??0} mocked AI context checks; durable reopen ${r.finalReopen===true}.`),'','## Limits','',...ruddsCoverageLimitations.map(x=>'- '+x),'','## Failures','',...results.flatMap(r=>r.failures.map(f=>`- ${r.id}, day ${f.day}, ${f.phase}: ${f.error}`))].join('\n')+'\n');
 assert.equal(results.length,15);
 assert.ok(results.every(r=>r.days.length===7),JSON.stringify(results.filter(r=>r.days.length!==7)));
 assert.ok(results.every(r=>r.operationalReseeds===0));
 assert.deepEqual(results.flatMap(r=>r.failures.map(f=>({position:r.id,...f}))),[]);
});
