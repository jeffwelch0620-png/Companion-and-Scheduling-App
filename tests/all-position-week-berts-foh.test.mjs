import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {confirmedDutiesForLocation,confirmedDutySource,starterTaskPacks} from '../.sites-runtime/shared/starter-tasks.mjs';
import {runPositionWeek} from './all-position-week-fixture.mjs';

// These scenarios rehearse saved app work using the confirmed references. A
// fictional software approval is never an approval of a restaurant procedure.
const references=confirmedDutiesForLocation('berts');
const reference=id=>{const value=references.find(x=>x.id===id);assert.ok(value,`Missing reference ${id}`);return value;};
const scenarios=rows=>rows.map(([title,detail,nextAction])=>({title,detail,nextAction}));
const common=(id,position,referenceId,dailyScenarios,goal)=>{
 const duty=reference(referenceId);
 return {id,restaurant:'berts',position,area:'FOH',opening:[...duty.opening],service:[...duty.service],closing:[...duty.closing],goal,dailyScenarios:scenarios(dailyScenarios),provenance:{kind:'owner-confirmed reference',referenceId,source:confirmedDutySource}};
};

export const bertsFohProfiles=[
 common('berts-server','Server','server-shared',[
  ['Wrong entrée','Guest identifies an incorrect entrée after delivery. Correction remains open until responsible staff follow through.','Tell Expo and the responsible manager; follow the correction back to the guest.'],
  ['Appetizer delay','Appetizer has not arrived while entrée timing advances. The employee needs an actionable handoff.','Communicate with Expo and keep guests informed; do not mark delivery complete from chat.'],
  ['Late guest need','A guest needs a refill while another table is ready to order. Prioritize attentive service.','Coordinate help and maintain refills and pre-bussing.'],
  ['Silverware backlog','Bagging silverware remains unfinished after existing tables are done.','Finish assigned side work and request the manager check.'],
  ['Section correction','Manager finds a missed seat or table during the physical close.','Correct the missed cleanup and request another check.'],
  ['Cut while tables remain','The manager stops new seating but the server still has existing guests.','Finish existing tables before side work, bank settlement and release.'],
  ['Interrupted checkout','Employee loses the connection after submitting closing readiness.','Reopen saved work and retry safely; the server must not self-release.'],
 ],'Practice order read-back, attentive service and accurate closing follow-through.'),
 common('berts-host','Host','host-shared',[
  ['Overloaded server','Next server in the written rotation is overloaded despite an open table.','Ask the manager for direction before seating that section.'],
  ['Unacknowledged arrivals','Guests arrive while the host walks another party to a table.','Use the waiting sign, nearby welcome and prompt acknowledgment on return.'],
  ['Rush seating pace','Several parties arrive together and the kitchen and servers are already stretched.','Keep a steady seating pace and report the backup to the manager.'],
  ['Rotation dispute','A server challenges the next section in the written rotation.','Check the written rotation and ask the manager rather than favoring a server.'],
  ['Dirty booster seat','A high chair or booster seat is missed during close.','Clean it and request a recheck; readiness is not confirmation.'],
  ['Silverware help','There is a backlog of silverware bags after menus and glass are cleaned.','Help bag silverware when needed.'],
  ['Reopen lost connection','Connection drops during the host closing submission.','Recover the saved state and avoid duplicating the submission.'],
 ],'Welcome guests and maintain the agreed steady seating pace.'),
 common('berts-back-window','Back Window','back-window-berts',[
  ['Missing cold component','Expo order is received during a rush without a required cold item.','Check against the ticket and communicate the missing item to Expo before handoff.'],
  ['Wrong name at pickup','A guest gives a name that does not match the attached ticket.','Match guest name and ticket and confirm payment before handing over food.'],
  ['Several orders at once','Multiple orders arrive together while guests are waiting.','Check contents while bagging and tagging each order, including cups and condiments.'],
  ['Dressing shortage','Closing count shows portioned ranch cups below the expected need.','Record the count and use the approved prep recommendation; do not invent a par or top up blindly.'],
  ['Changeover pending order','One order is ready on the table and another is still pending at changeover.','Pass along ready and pending orders; the manager owns drawer closeout.'],
  ['Restroom missed','Employee restroom cleaning is missed in the initial close.','Complete the employee restroom and request another closing check.'],
  ['Duplicate submission','Network interruption prompts a second tap after closing readiness.','Recover the existing result; do not create duplicate work or release yourself.'],
 ],'Check each complete order against its ticket before pickup.'),
 common('berts-busser','Busser','busser-shared',[
  ['Missing reset supplies','A required tub or sanitation towel is unavailable on arrival.','Check with the manager before using an unapproved method.'],
  ['Guest still seated','A table appears partly cleared but guests have not left.','Help pre-bus and clear only appropriately released items.'],
  ['Seat missed','Tabletop is clean but one seat is still dirty.','Wipe each seat and push applicable chairs in before the table is ready.'],
  ['Several vacated tables','Several parties leave together while entrances need attention.','Float the dining room and coordinate priorities with the manager.'],
  ['Extra assigned trash','Manager identifies unfinished dish or trash detail before departure.','Finish the assigned work and request review.'],
  ['Server needs help','One server requests help before the busser leaves.','Check with each server then the manager for remaining work.'],
  ['Carryover cleanup','A closing correction stays open across the date change.','Recover the saved correction and get manager verification.'],
 ],'Leave each reset table and seat ready and coordinate remaining help before departure.'),
 common('berts-food-runner','Food Runner','runner-shared',[
  ['Expo needs restock','Expo is short on service supplies when the runner arrives.','Check Expo needs and help restock the window.'],
  ['Unidentified plate','Several guests may have ordered similar dishes.','Announce the dish politely, let the guest identify it and place it for them.'],
  ['Incorrect modifier','Guest identifies an incorrect item or modifier at delivery.','Tell Expo and the server so the correction gets followed through.'],
  ['Missing plate','A guest reports a missing item from the order.','Bring the missing item to Expo attention and inform the server.'],
  ['Runner cut early','The runner is nearing departure while Expo still needs help.','Check Expo, servers and manager before leaving.'],
  ['Last delivery pending','A final food delivery is still in progress during closing.','Hand off remaining delivery work explicitly before checkout.'],
  ['Saved correction overnight','A reported guest correction remains unresolved after close.','Recover the issue and its next action without treating a chat answer as completion.'],
 ],'Deliver the identified order and follow guest corrections through Expo and the server.'),
 common('berts-expo','Expo','expo-berts',[
  ['Cooking error','A cooked item is incorrect before the order leaves Expo.','Request a recook or remake.'],
  ['Ordering error','Ticket or ordering detail is incorrect before handoff.','Contact the FOH manager to resolve the ordering issue.'],
  ['Incomplete order','A required component is missing before releasing the order.','Communicate the missing component and hold the incomplete handoff.'],
  ['Back Window question','Back Window identifies a missing condiment or food component.','Correct the issue with Back Window and identify what is still pending.'],
  ['Late pizza help','A late pizza needs catching after the dedicated catch employee leaves.','Coordinate Expo or manager help without silently assigning a departed employee.'],
  ['Shutdown missed','Window heater or bread drawer is missed in closing readiness.','Complete the shutdown and request another independent check.'],
  ['Dips not put away','Manager finds dips or broccoli still out during closing.','Refrigerate the required items and finish the shelf, table, microwave and screen close.'],
 ],'Release accurate complete orders and use the correct cooking-versus-ordering correction path.'),
 {
  id:'berts-foh-manager',restaurant:'berts',position:'FOH Manager',area:'FOH',
  capabilities:['tasks.manage','close.confirm','standards.approve','schedule.manage','schedule.publish','schedule.change','people.manage'],
  opening:['Read the Red Book, check staffing and assignments, walk restaurant readiness, and coordinate shortages with BOH.'],
  service:['Monitor seating pace and guest recovery; host and servers communicate during brief guest conversations.','Coordinate FOH and BOH staffing cuts as business slows; normally cut covered support duties before servers.','Tell the host no more tables for a cut server; the server finishes existing tables.'],
  closing:['Check side work and settle server banks before release.','Personally inspect the dining room, bathrooms and entrances.','Complete cash reconciliation and the Red Book, and hand unfinished work to the final closer.'],
  goal:'Coordinate service coverage and verify close before releasing employees.',
  provenance:{kind:'owner-confirmed management transcript',source:'Current chat: management walkthrough resumed and confirmed for Bert’s and Rudd’s; separate cash routines retained.'},
  dailyScenarios:scenarios([
   ['Staffing call-out','Support coverage is missing as service starts.','Arrange coverage and communicate assignments; do not turn a proposed change into a published shift automatically.'],
   ['Brief guest recovery','Manager is briefly occupied resolving a table issue.','Hosts and servers communicate backups; do not invent a new floor authority.'],
   ['Manager stuck on Expo','Manager is tied up at Expo for an extended period.','Treat extended loss of floor coverage as a staffing issue to correct.'],
   ['Slowdown staffing cuts','Business slows while support and BOH staffing remain high.','Coordinate cuts across FOH and BOH with covered duties and servers normally last.'],
   ['Server cut','A server is cut while still responsible for guests.','Stop new seating, finish existing tables, verify side work and settle the bank before release.'],
   ['Bathroom inspection fails','Personal closing walk finds an incomplete bathroom assignment.','Return the work for correction and recheck it before release.'],
   ['Unresolved Red Book item','A maintenance or service issue remains unresolved at final close.','Assign and hand off the unfinished work with an owner and next action.'],
  ]),
 },
];

const expo=bertsFohProfiles.find(x=>x.position==='Expo');
expo.opening=[...starterTaskPacks.find(x=>x.id==='expo').opening];
expo.provenance.opening='Supplemental unapproved starter draft used as a clearly fictional QA fixture; confirmed Expo opening is missing from catalog.';
export const bertsFohCoverageLimitations=[
 'Expo opening is missing from the confirmed catalog; supplemental starter draft is QA input, not approved restaurant policy.',
 'Detailed Bert’s section assignments and side-work sheet are not embedded in this generic confirmed Server catalog; seven-day workflow coverage does not verify the recovered sheet contents.',
 'FOH Manager uses owner-confirmed transcript rather than a dedicated confirmed-duty catalog row.',
 'No physical food handoff, guest seating, POS order, payment, bank settlement or physical inspection is performed by software simulation.',
 'Back Window recipes and burn-rate recommendations still require the verified Jeff source connection; the generic week checks saved follow-through, not hosted recipe pulling.',
];

fs.mkdirSync('evidence/all-position-week',{recursive:true});
fs.writeFileSync('evidence/all-position-week/berts-foh-profiles.json',JSON.stringify(bertsFohProfiles,null,2)+'\n');

for(const profile of bertsFohProfiles)test(`${profile.restaurant} ${profile.position}: seven durable full-shift days and curveballs`,async()=>{
 const result=await runPositionWeek(profile);
 result.provenance=profile.provenance;
 result.contentLimits=bertsFohCoverageLimitations;
 fs.mkdirSync('evidence/all-position-week',{recursive:true});
 fs.writeFileSync(`evidence/all-position-week/${profile.id}.json`,JSON.stringify(result,null,2)+'\n');
 assert.equal(result.days.length,7);
 assert.deepEqual(result.failures,[],JSON.stringify(result.failures));
});
