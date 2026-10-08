// Server-only source snapshots. Document text is evidence, never runtime instructions.
import type { SourceLibrary } from './source-library-types';
export const sourceLibrary:SourceLibrary = {
  "batchId": "berts-operations-2026-09-10",
  "capturedAt": "2026-09-10",
  "scope": "Selected Bert’s operating sources from the OneDrive business intake. Menus, schedules, financial files and other brands were not promoted.",
  "documents": [
    {
      "id": "berts-source-0e4d8d311f37aa79",
      "title": "Bert’s Dishwasher Operating Module — v1.1",
      "filename": "Bert’s Dishwasher Operating Module — v1.1.md",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "Dish"
      ],
      "roles": [
        "Dishwasher"
      ],
      "documentType": "Station SOP",
      "operationalUse": [
        "Safety / cleaning",
        "Opening / closing",
        "Reference only"
      ],
      "assignment": "Dishwasher · Dish",
      "sourceOwner": null,
      "preparedBy": "Manus AI",
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "draft",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Bert’s Dishwasher Operating Module — v1.1.md",
      "sha256": "0e4d8d311f37aa79659280289c9ae37c8d7fa6ad864349e32c733ebf82af2e5e",
      "textSha256": "0e4d8d311f37aa79659280289c9ae37c8d7fa6ad864349e32c733ebf82af2e5e",
      "capturedAt": "2026-09-10",
      "relatedVersions": [],
      "duplicates": [],
      "conflicts": [
        "missing-methods"
      ],
      "content": "# Bert’s Dishwasher Operating Module — v1.1\n\n**Platform:** JMAX Operations Companion  \n**Prepared for:** Jason Albert and Rudd Maxwell  \n**Prepared by:** Manus AI  \n**Status:** Review baseline; **no build authorized**  \n**Added source:** Raw Source 003 — Dish Station Ownership Standard\n\n## Decision-status key\n\n| Status | Meaning |\n|---|---|\n| **Confirmed** | Jason and/or Rudd explicitly defined the standard |\n| **Working default** | A practical starting design supplied for review |\n| **Configuration needed** | Bert’s equipment, chemical, timing, or location-specific value must be inserted later |\n| **Deferred** | Useful later, but not required to approve this role module |\n\n## 1. One-page role card\n\n| Field | Bert’s Dishwasher standard |\n|---|---|\n| **Role** | Dishwasher / Dish |\n| **Department** | Back of House |\n| **Primary purpose** | Keep safe, clean, dry, organized dishes and equipment moving fast enough that the restaurant can operate without stations inheriting preventable Dish failures |\n| **Reports to** | The designated BOH leader for the shift |\n| **Handoff verifier** | One specifically assigned BOH Manager, Shift Leader, or authorized closing manager—not “any available manager” |\n| **Night staffing** | Two employees are assigned to the single Dish position every night and share responsibility for the complete area |\n| **Required Companion use** | Arrival, responsibility handoff, final checkout, three-hour machine-clean record, and genuine help/problem reporting |\n| **Not required** | Continuous app use during service, routine photos, separate Dirty Side/Clean Side app roles, or a separate Morning Dish title |\n\n> **Role principle:** Dish owns the condition and flow of the complete Dish area while assigned to it. Prep employees still own the cleanup created by completed prep work.\n\n## 2. Five owned outcomes\n\n| Owned outcome | What “done correctly” means |\n|---|---|\n| **1. Machine and chemical readiness** | The machine is assembled, operating, supplied, and checked against Bert’s approved temperature and chemical standards before use and after every required refresh |\n| **2. Safe dirty-to-clean flow** | Dirty ware moves through scraping, rinsing, washing, sanitizing, air-drying, sorting, and put-away without clean ware being recontaminated or wet-nested |\n| **3. Throughput and organization** | Dishes continue moving; clean items are put away; trash is controlled; the work area does not become an unmanaged pile that threatens service |\n| **4. Complete area reset** | Floors, drains, trash, machine, removable components, storage, and surrounding Dish area meet the applicable handoff or closing standard |\n| **5. Honest handoff** | The next person receives the actual condition, remaining work, reason, and priority—never a surprise or hidden backlog |\n\nThe FDA Food Code is a model code rather than a substitute for local requirements, but it supports the sanitation principles behind this module, including effective warewashing and air-drying rather than stacking wet utensils.[1] RestaurantOwner’s Dishwasher Training Program supports building role-specific training with observation and verification instead of relying only on written instructions.[2]\n\n## 3. Responsibility boundaries\n\n### Prep-to-Dish ownership — **Confirmed**\n\n> **Zero abandoned prep dishes.**\n\nWhen a prep task or batch is complete, the employee who performed it cleans and puts away the tools, containers, and equipment used. The work does not transfer to Dish because the dishwasher has not arrived.\n\nMorning Dish may inherit items from preparation that is **genuinely still active**. Those items must be scraped, rinsed, soaked when appropriate, or staged so they can move directly through Dish. Abandoned work is attributed to the station that created it, routed to the BOH Manager, and excluded from Dishwasher performance.\n\n| Condition at Dish arrival | Ownership and response |\n|---|---|\n| **Ready** | Dish accepts the area and begins setup or service |\n| **Active prep items staged correctly** | Dish accepts expected live work |\n| **Completed prep work abandoned** | Creating station owns the failure; Dish records the station and one picture; BOH Manager receives the exception |\n| **Overnight or dried/baked-on ware** | Prior responsible shift or station owns the exception; Dish is not scored against the inherited condition |\n| **Unsafe machine, temperature, or chemical condition** | Dish stops the affected operation and alerts the designated leader before continuing |\n\n### Two-person night staffing — **Confirmed**\n\nTwo employees share responsibility for the complete Dish area every night. They may move between tasks and help wherever needed. Dirty-to-clean separation remains mandatory training and operating behavior, but JMAX does not create separate Dirty Side and Clean Side positions or app assignments unless Jason and Rudd later request that change.\n\n### Verifier responsibility — **Confirmed**\n\nOne named leader is assigned responsibility for each handoff and close. That person physically verifies the standard and releases the Dish team. The role may vary by shift; the accountability may not.\n\n## 4. Decision authority\n\n| Dishwasher may | Dishwasher may not |\n|---|---|\n| Stop using the machine and report an unsafe or failed chemical, temperature, or equipment condition | Alter chemical dispensing, bypass safety controls, or attempt unauthorized repairs |\n| Mark abandoned prep work as inherited and identify the creating station | Quietly accept responsibility for abandoned work or falsely mark the area ready |\n| Request manager help when volume, equipment, staffing, or supply conditions prevent recovery | Hide a backlog until handoff or leave without communicating the condition |\n| Reject touching clean ware after dirty-side work until hands are washed and the employee is reset for clean handling | Move directly from contaminated work to catching or putting away clean ware |\n| Ask for clarification when the Bert’s standard is unclear | Substitute a personal definition of clean, stocked, staged, or complete |\n\n**Working default:** AI and JMAX may guide, record, remind, and route. A human leader decides whether work passes, whether an employee may leave, and whether a condition becomes coaching or formal performance management.\n\n## 5. Required Companion touchpoints\n\n| Moment | Required interaction | Target burden |\n|---|---|---:|\n| **Morning arrival** | Accept normal readiness, accept correctly staged active prep, or report inherited exception | 20–30 seconds when normal |\n| **Every three operating hours** | Record machine refresh as **Completed** or **Problem** | Under 10 seconds when normal |\n| **3:00 p.m. handoff** | Outgoing readiness, leader PASS/FIX, incoming Accept/Dispute | Under 60 seconds when normal |\n| **Final close** | Dish team requests checkout; designated closing leader verifies and releases | Under 60 seconds when normal |\n| **During service** | Open only for a real issue, help request, standard clarification, or required machine-clean record | Exception only |\n\nThis design respects the operating reality Jason described: most Team Members will not and should not live inside the app during service.\n\n## 6. Arrival standard\n\nThe Companion opens with the shift and location already known:\n\n> **You’re on Dish at Bert’s. What did you inherit?**  \n> **Ready** · **Active prep staged** · **Abandoned work** · **Machine/chemical problem**\n\n| Arrival check | Standard |\n|---|---|\n| **Inherited workload** | Active prep is distinguished from abandoned completed work before Dish takes ownership |\n| **Machine assembly** | Machine and removable components are correctly assembled after overnight air-drying |\n| **Operating condition** | Machine reaches Bert’s approved operating condition before use |\n| **Chemicals** | Products are present, connected, and verified against the approved site standard |\n| **Trash setup** | Required receptacles are present, lined, and positioned correctly |\n| **Rack readiness** | Clean usable racks are available and organized |\n| **Dish tables** | Dirty and clean tables are clean, clear, and usable for the assigned flow |\n| **Flow setup** | Dirty intake, racks, clean landing, drying, sorting, and put-away paths are clear |\n| **Prior-night condition** | Dried-on ware, leftover trash, dirty floors/drains, or incomplete machine close is recorded before work begins |\n\nA normal arrival requires no photo. **Abandoned work or a disputed inherited condition requires one useful picture**, tagged to the responsible station when known.\n\n## 7. During-service standard\n\nDish works as one shared station. The priority is continuous flow, not checking boxes.\n\n| Priority | Required behavior |\n|---:|---|\n| **1** | Protect sanitation: maintain separation between contaminated work and clean ware; wash hands and reset before handling clean items |\n| **2** | Keep the machine supplied and operating within Bert’s approved standards |\n| **3** | Prevent the dirty queue from becoming an unmanaged service risk |\n| **4** | Allow ware to air-dry and prevent wet nesting before stacking or storage |\n| **5** | Sort and put clean items away so production and service can retrieve them |\n| **6** | Control trash, floors, drains, clutter, and obstructions throughout the shift |\n| **7** | Raise equipment, chemical, staffing, injury, broken-glass, or uncontrollable-volume problems early rather than quietly carrying them |\n\nNo routine reflective question or development prompt is sent during a rush. The Companion may surface a required machine-clean control or a direct manager assignment, but otherwise stays out of the way.\n\n## 8. Three-hour dish-machine refresh\n\nEvery three hours while the machine is operating, Dish completes the following **confirmed Bert’s cycle**. An older recovered checklist stated four hours; that frequency is preserved in the raw source but is superseded provisionally by Jason and Rudd’s newer explicit three-hour instruction:\n\n| Step | Required condition |\n|---:|---|\n| **1** | Drain the machine |\n| **2** | Remove and clean the screens |\n| **3** | Clear and inspect spray arms or jets |\n| **4** | Wipe the machine interior |\n| **5** | Refill the machine |\n| **6** | Confirm chemicals and operating temperature are correct |\n| **7** | Record **Completed** or **Problem** |\n\nThe timer begins when the machine is placed into service. A completed refresh resets the next due time. When a cycle overlaps the 3:00 p.m. handoff, it is completed before the incoming Dishwasher accepts responsibility.\n\n| Status | Routing |\n|---|---|\n| **Completed on time** | Record quietly; no picture and no management interruption |\n| **Approaching due** | Brief reminder to the assigned Dish team |\n| **Overdue** | Route to the designated Shift Leader or BOH Manager |\n| **Problem** | Ask for the problem type and route immediately to the responsible leader |\n| **Repeated overdue pattern** | Summarize by shift and verifier for BOH Manager or GM review |\n\n**Configuration needed:** Insert the exact Bert’s operating-temperature range, chemical products, concentration or test method, machine identifier, and any manufacturer-required shutdown steps. These values should come from the machine instructions, chemical provider, and applicable local regulatory standard—not AI guesswork.[1]\n\n## 9. Responsibility handoffs\n\nDish has three control points: morning arrival, 3:00 p.m., and final close. Every transfer requires an explicit owner, verifier, and receiving party when another Dishwasher follows.\n\n### 3:00 p.m. standard — **Confirmed baseline**\n\n| Check | Normal passing condition |\n|---|---|\n| **Lunch ware** | Processed, dry, sorted, and put away |\n| **Pans and containers** | No dried, baked-on, or abandoned items |\n| **Flow** | Dirty and clean areas organized and usable |\n| **Trash** | Controlled and not left for the incoming shift without disclosure |\n| **Chemicals** | Present and operating correctly |\n| **Machine refresh** | Any cycle due at handoff is completed |\n| **Remaining queue** | Only genuinely active service work remains, clearly staged |\n| **Communication** | Anything incomplete is disclosed with reason, work already completed, and first priority |\n\nVolume varies. A less-than-perfect reset is not automatically a failed handoff when the condition is honest, organized, explained, and accepted.\n\n> **Communication makes a high-volume handoff acceptable; surprise makes it a failure.**\n\n### 3:00 p.m. interaction\n\n1. The outgoing Dishwasher selects **Ready for handoff**.\n2. The designated leader checks the critical conditions and selects **PASS** or **FIX**.\n3. If **FIX**, the employee completes the correction or the leader records why an exception must transfer.\n4. The incoming Dishwasher selects **Accept** or **Dispute** before materially changing the area.\n5. A dispute identifies the failed standard and attaches one useful picture.\n6. The responsible manager resolves the dispute; owners see only repeated or unresolved patterns.\n\n## 10. Final closing standard\n\n| Closing condition | Required result |\n|---|---|\n| **Ware completion** | Remaining dishes are processed, air-dried, sorted, and put away |\n| **Dish area** | Surfaces and work paths are cleaned, organized, and free of concealed abandoned work |\n| **Floors** | Swept and mopped |\n| **Drains** | Cleaned to Bert’s approved closing standard |\n| **Trash** | Removed and receptacles reset |\n| **Dumpster zone** | Assigned dumpster area is free of loose debris and boxes and meets the approved closing condition |\n| **Pans and racks** | Pans are organized and clean racks are available for the next service period |\n| **Cleaning tools** | Dustpans are rinsed; mops and brooms are stored properly; mop buckets are emptied |\n| **Dish tables** | Tables are cleaned and left organized for the next service period |\n| **Chemicals** | Left in the approved safe closing condition |\n| **Machine** | Drained and fully cleaned |\n| **Screens/components** | Removed, cleaned, and left disassembled to air-dry overnight |\n| **Handoff communication** | Any legitimate unresolved equipment or facility problem is disclosed and routed before release |\n\nThe closing leader checks the **area once as a shared Dish outcome** and records each scheduled Dishwasher’s release status. This is a **working default** for review: shared responsibility does not require duplicate inspections, but the record should show who remained through verification and who was released earlier.\n\nThe current Toast access is read-only. JMAX can record a required release and flag a missed checkout, but it should not claim to physically block a Toast clock-out until a future write-capable integration exists. The operating expectation remains non-negotiable even when the software gate is initially soft.\n\n## 11. Bounded AI experience\n\nThe Dishwasher does not receive an unrestricted chatbot. AI is confined to Dish work, personal schedule, approved training, goals, feedback, and issue reporting.\n\n### Arrival examples\n\n> **Companion:** “You’re on Dish at Bert’s. What did you inherit?”  \n> **Employee:** “Abandoned work.”  \n> **Companion:** “Which station created it? Add one picture before you move anything. I’ll route it to the BOH Manager and keep it off your starting record.”\n\n### Machine-clean example\n\n> **Companion:** “Dish-machine refresh is due. Drain and refill, clean screens, clear spray arms, wipe the interior, then check chemicals and temperature.”  \n> **Buttons:** **Completed** · **Problem**\n\n### Handoff example\n\n> **Companion:** “You’re handing Dish to the 3:00 team. Is lunch ware put away, the flow organized, trash controlled, and the machine refresh current?”  \n> **Buttons:** **Ready** · **Need help**\n\n### High-volume exception example\n\n> **Employee:** “We still have two active racks from lunch.”  \n> **Companion:** “What caused the carryover: volume, equipment, staffing, chemicals, or another station? What should the incoming team handle first?”\n\n### Scope refusal example\n\n> **Employee:** “Write my school essay.”  \n> **Companion:** “I can help with your Bert’s shift, Dish standards, schedule, training, goals, or a workplace issue. I can’t perform unrelated personal work.”\n\n## 12. Evidence and escalation\n\n| Event | Evidence | First destination | Escalates when |\n|---|---|---|---|\n| Normal arrival | One status tap | No one | Never |\n| Active prep staged | Status and optional station note | No one unless disputed | Pattern shows poor staging |\n| Abandoned prep work | Creating station + one picture | BOH Manager | Repeated, unresolved, or management ignores it |\n| Machine refresh completed | Timestamp | No one | Repeated suspicious or late completion pattern |\n| Machine or chemical problem | Problem type; picture only if useful | Designated leader | Safety risk, downtime, or overdue resolution |\n| 3:00 PASS | Verifier and timestamp | No one | Never |\n| 3:00 dispute | Failed standard + one picture | Responsible Manager | Repeated station/verifier pattern or unresolved |\n| Close PASS | Verifier, scheduled Dish team, timestamp | No one | Never |\n| Close FIX | Failed standard and correction | Closing leader | Employee leaves without correction or pattern repeats |\n\nThe owner layer receives a compressed exception such as:\n\n> **Dish handoff trend:** Four prep-abandonment exceptions this week originated from the same BOH station. BOH Manager received each event; two remain unresolved. Evidence is available.\n\nRoutine Dish events remain below owner level. Owners receive only a compressed repeated, unresolved, systemic, or serious exception and do not receive separate pictures unless they request the permitted evidence.\n\n## 13. Measurement without gaming\n\nThe module measures whether the operating system is improving, not whether people tap buttons.\n\n| Useful measure | What it reveals |\n|---|---|\n| **Arrival exceptions by creating station** | Whether prep teams are honoring zero abandoned dishes |\n| **Three-hour refresh completion and lateness** | Whether machine care is happening at the required cadence |\n| **3:00 handoff PASS/FIX/Dispute trend** | Whether the next shift receives an honest, controlled station |\n| **Final close verification misses** | Whether the designated leader is enforcing the standard |\n| **Repeated verifier-linked disputes** | Possible rubber-stamping or inconsistent expectations |\n| **Machine/chemical downtime** | Equipment, vendor, maintenance, or supply problems outside employee control |\n| **Owner escalations** | Whether management is closing issues before they become owner work |\n\nA single bad handoff is coaching data. A repeated pattern is management data. An unresolved repeated pattern after GM involvement becomes owner data.\n\n## 14. Training and mastery baseline\n\nDetailed station levels and certification mechanics remain deferred. For this role, a Dishwasher is ready to work without constant rescue when an authorized manager observes that the employee can:\n\n| Observable ability | Standard |\n|---|---|\n| **Set up** | Assemble and start the machine, verify chemicals and operating condition, and establish clean/dirty flow |\n| **Process safely** | Move ware through the correct sequence without recontaminating clean items or wet nesting |\n| **Maintain pace** | Keep dishes moving, sorted, and put away under the assigned shift conditions |\n| **Complete machine care** | Perform and record the full three-hour refresh correctly |\n| **Communicate** | Report inherited work, equipment issues, and unrecoverable backlog early and honestly |\n| **Hand off** | Reach or honestly explain the 3:00 condition and participate in Accept/Dispute correctly |\n| **Close** | Complete the full closing standard and obtain designated-leader release |\n\nAny formal training plan, number of observed shifts, quiz, or certification sequence is a later configuration. This module does not invent those requirements.\n\n## 15. Goals and recognition — deferred configuration\n\nRequired Dish standards are not optional goals. A future weekly operating focus may help reinforce execution—for example, three accepted handoffs, zero wet nesting, or on-time machine refreshes—but goal cadence, selection, and public recognition remain outside approval of this core role standard.\n\nRecognition should be based on verified performance rather than app activity. The Companion should never reward a tap that the operating evidence contradicts.\n\n## 16. JMAX review sheet\n\nJason and Rudd only need to mark the following sections **KEEP, CHANGE, or DELETE**:\n\n| Review section | Status |\n|---|---|\n| One-page role card and five outcomes |  |\n| Prep-to-Dish ownership |  |\n| Arrival standard |  |\n| During-service standard |  |\n| Three-hour machine refresh |  |\n| 3:00 p.m. handoff |  |\n| Final close, dumpster zone, and cleaning-tool reset |  |\n| Verifier and release structure |  |\n| Bounded AI interactions |  |\n| Evidence and escalation |  |\n| Training/mastery baseline |  |\n\n### Configuration values to fill later—not founder questions today\n\n| Field | Source when needed |\n|---|---|\n| Machine operating-temperature range | Equipment documentation / chemical provider / applicable local standard |\n| Chemical products and verified concentration/test method | Chemical provider and Bert’s approved procedure |\n| Machine identifier and service vendor | Bert’s equipment record |\n| Exact opening and close times | Published operating schedule |\n| Approved drain-cleaning method | Bert’s sanitation procedure |\n| Approved dumpster-area boundary and closing condition | Bert’s property/cleaning-zone assignment |\n| Cleaning-tool and mop-bucket storage locations | Bert’s sanitation setup |\n| Named verifier by shift | Manager schedule or shift assignment |\n\n## References\n\n[1]: https://www.fda.gov/food/fda-food-code/food-code-2022 \"U.S. Food and Drug Administration — Food Code 2022\"\n[2]: https://www.restaurantowner.com/members/Dishwasher-Training-Program-2.cfm \"RestaurantOwner — Dishwasher Training Program\"\n"
    },
    {
      "id": "berts-source-655fc5318ae8b461",
      "title": "Bert’s Fry Station Module — v1",
      "filename": "Bert’s Fry Station Module — v1.md",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "Fry"
      ],
      "roles": [
        "Cook"
      ],
      "documentType": "Station SOP",
      "operationalUse": [
        "Training source",
        "Safety / cleaning",
        "Opening / closing"
      ],
      "assignment": "Cook · Fry",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "draft",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Bert’s Fry Station Module — v1.md",
      "sha256": "655fc5318ae8b46125c6ad1f57802da305dd640412e446e84f8503936547c339",
      "textSha256": "655fc5318ae8b46125c6ad1f57802da305dd640412e446e84f8503936547c339",
      "capturedAt": "2026-09-10",
      "relatedVersions": [],
      "duplicates": [],
      "conflicts": [
        "missing-methods"
      ],
      "content": "# Bert’s Fry Station Module — v1\n\n**Inherits:** `Berts_Shared_BOH_Core_Standard_v1.md`  \n**Primary JMAX source:** Raw Source 005 — Fryer / Fry Station Team Member  \n**Secondary source:** Source 007 recovered historical Fry stock categories  \n**Status:** Working review baseline; no software build authorized\n\n## 1. Station purpose\n\nThe Fry assignment operates the fry station safely and efficiently, prepares approved fried menu items to Bert’s recipe and quality standards, protects oil and equipment condition, supports ticket flow, and leaves the station in the approved closing condition.\n\nFry is a station proficiency and shift assignment under BOH/Cook, not a separate permission tier.\n\n## 2. Fry-owned outcomes\n\n| Outcome | Definition of done | Status |\n|---|---|---|\n| **Safe fryer readiness** | Fryers are filled, started, and maintained according to the approved equipment and oil procedure | Raw-source baseline; exact method needed |\n| **Product readiness** | Approved breaded, battered, portioned, frozen, refrigerated, and sauce items are ready for forecasted demand | Raw-source baseline; current item list and pars needed |\n| **Fry quality** | Items are dropped, timed, removed, seasoned, held, and presented to the approved standard without avoidable overcooking or stacking | Raw-source baseline; recipes needed |\n| **Ticket flow** | Fry communicates timing and bottlenecks early enough to protect Expo and adjacent-station flow | Source-supported baseline |\n| **Oil and station control** | Oil is filtered/replaced when required, waste is handled safely, and the fry zone remains clean and organized | Raw-source baseline; exact triggers and methods needed |\n\nRestaurantOwner’s generic Fry setup guidance emphasizes intentional station setup, preshift line checks, stock visibility, quality control, and early bottleneck detection. It does not provide Bert’s fryer temperatures, oil procedures, recipes, or pars.[1]\n\n## 3. Opening readiness\n\n| Opening control | Working standard |\n|---|---|\n| **Fryer condition** | Inspect the fryer area and report leaks, damage, unsafe oil, or abnormal equipment before startup |\n| **Oil and startup** | Fill/start only according to the approved Bert’s/equipment procedure; confirm the approved operating condition |\n| **Tools and safety items** | Confirm baskets, skimmers, timers, tongs, pans, landing/seasoning area, PPE, and waste controls |\n| **Product** | Confirm approved fry items, breading/batter, portions, sauces, and finishing supplies |\n| **Stock and pars** | Compare on-hand product with the expected shift need; disclose shortages early |\n| **Work area** | Ensure the fry zone, surrounding floor, landing area, and fire/safety access are organized and usable |\n| **Manager line check** | BOH leadership verifies critical stock, oil/equipment condition, product quality, and readiness before peak |\n\n## 4. During-service ownership\n\n| Service duty | Working standard |\n|---|---|\n| **Prepare** | Bread, batter, portion, or stage items using the approved recipe and cross-contact controls |\n| **Drop and time** | Load the correct quantity, use the approved cook method, and avoid overloading or unplanned mixing |\n| **Remove and finish** | Remove finished product promptly; drain/season/portion/hold according to the item standard |\n| **Protect quality** | Do not serve overcooked, degraded, improperly held, or otherwise failed product; notify management and record required waste/remake |\n| **Maintain flow** | Communicate item timing, shortages, equipment issues, and a developing backlog to Expo/BOH leadership |\n| **Maintain oil/equipment** | Perform required skimming, filtering, checks, and area cleanup at the approved cadence |\n| **Support the line** | Help adjacent stations only when Fry is controlled or when directed by the responsible leader |\n\nThe Companion should remain quiet during normal service. It may surface a required oil/equipment control, shortage, quality exception, or direct manager assignment.\n\n## 5. Closing additions unique to Fry\n\nThe station inherits the universal BOH close and adds:\n\n| Closing control | Working standard | Status |\n|---|---|---|\n| **Fry product** | Store, cover, label, date, rotate, or dispose of product according to its approved rule | Probable baseline |\n| **Breading/batter and sauces** | Leave in the approved safe closing condition; do not transfer abandoned prep cleanup to Dish | Probable baseline |\n| **Oil** | Filter, test, retain, replace, or prepare for disposal according to the approved trigger and safe method | Raw-source baseline; exact rule needed |\n| **Fryer equipment** | Clean approved components and leave equipment in the approved overnight condition | Raw-source baseline; manufacturer/site method needed |\n| **Fry zone** | Clean landing/seasoning areas, surrounding surfaces, assigned floor/mat, and safe-access area | Probable baseline |\n| **Waste** | Record product/oil waste where required and dispose of it using the approved safe procedure | Raw-source baseline; exact process needed |\n| **Release** | Receive checkout and release from the authorized closing leader | Shared-close working pattern |\n\nNo AI-generated instruction may override the fryer manufacturer, chemical/oil vendor, fire-safety requirements, or Bert’s approved hot-oil procedure.\n\n## 6. Historical stock material\n\nThe recovered PDF listed fries, onion tanglers, ravioli, green beans, pickles, tenders, buffalo bites, onion loaf, beer cheese, pretzels, and sauces as prior Fry categories. This is **historical menu evidence**, not an approved current item list or par. Validate it against the current Toast menu and current station before use.\n\n## 7. Evidence and escalation\n\n| Event | Evidence | Destination |\n|---|---|---|\n| Normal readiness | Short Ready status and line-check verification where required | No escalation |\n| Product shortage | Item/category, on-hand condition, and needed action | BOH leader |\n| Fryer/oil safety issue | Equipment/oil condition and immediate operating impact; picture only if safe/useful | Responsible leader immediately |\n| Quality failure | Item, failed standard, correction, and waste/remake where required | BOH Manager |\n| Missed filtering/maintenance control | Required control and reason | BOH leader |\n| Failed close or inherited mess | Failed condition and one useful picture | Responsible manager |\n| Repeated pattern | AI summary by station, cause, shift, and verifier | GM; owner only when unresolved/systemic |\n\n## 8. Bounded AI examples\n\n> **Arrival:** “You’re assigned to Fry. Confirm fryer condition, oil/startup, products, tools, and shortages.”\n\n> **Quality:** “This batch did not meet the approved quality standard. Record the product and cause; I’ll route the recurring pattern, not every normal batch.”\n\n> **Equipment:** “Stop and notify the BOH leader if the fryer or oil condition is unsafe. I cannot authorize repairs or a workaround.”\n\n> **Close:** “Product secured, oil handled by the approved rule, fryer components and fry zone cleaned, waste recorded, and equipment left in the approved overnight state. Ready for verification?”\n\n## 9. Configuration still needed\n\n| Configuration | Source when activated |\n|---|---|\n| Current Fry menu ownership | Toast menu and JMAX review |\n| Product, breading, batter, sauce, and tool lists | Current station setup |\n| Shift stock and pars | PMIX, forecast, current counts, manager approval |\n| Fryer startup/operating/shutdown method and temperatures | Manufacturer and Bert’s approved procedure |\n| Item cook, hold, finish, and presentation standards | Bert’s recipe/quality system |\n| Oil filtering and replacement trigger | Bert’s approved oil-management procedure |\n| Oil cooling, transfer, storage, and disposal method | Bert’s safety/vendor procedure |\n| Fire-safety and PPE controls | Approved safety procedure |\n| Authorized verifier | Manager schedule/capability assignment |\n\n## Review instruction\n\nMark purpose, outcomes, opening, service, closing, and evidence **KEEP, CHANGE, or DELETE**. Review the historical Fry item list separately; it is not treated as current policy.\n\n## Reference\n\n[1]: https://www.restaurantowner.com/members/Station-Setup-Line-Check-Fry.cfm \"RestaurantOwner — Fry Station Setup and Line Check\"\n"
    },
    {
      "id": "berts-source-828b3f9344eec0a2",
      "title": "Bert’s Grill Station Module — v1",
      "filename": "Bert’s Grill Station Module — v1.md",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "Grill"
      ],
      "roles": [
        "Cook"
      ],
      "documentType": "Station SOP",
      "operationalUse": [
        "Training source",
        "Opening / closing"
      ],
      "assignment": "Cook · Grill",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "draft",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Bert’s Grill Station Module — v1.md",
      "sha256": "828b3f9344eec0a2e269809f3f49d8e0c6359c9af155ca0a84759652ea12dfb6",
      "textSha256": "828b3f9344eec0a2e269809f3f49d8e0c6359c9af155ca0a84759652ea12dfb6",
      "capturedAt": "2026-09-10",
      "relatedVersions": [],
      "duplicates": [],
      "conflicts": [
        "station-boundaries",
        "missing-methods"
      ],
      "content": "# Bert’s Grill Station Module — v1\n\n**Inherits:** `Berts_Shared_BOH_Core_Standard_v1.md`  \n**Primary JMAX source:** Raw Source 006 — Grill Cook / Grill Station Team Member  \n**Secondary source:** Source 007 recovered historical Grill stock categories  \n**Status:** Working review baseline; no software build authorized\n\n## 1. Station purpose\n\nThe Grill assignment prepares approved meats, vegetables, and other grill items according to Bert’s recipes, food-safety requirements, requested doneness, portions, timing, and presentation standards. The station maintains readiness, communicates timing, protects product quality, and leaves a responsible close.\n\nGrill is a station proficiency and shift assignment under BOH/Cook, not a separate permission tier.\n\n## 2. Grill-owned outcomes\n\n| Outcome | Definition of done | Status |\n|---|---|---|\n| **Ready before service** | Required equipment, utensils, ingredients, finishing items, and safe work surfaces are ready for forecasted demand | Raw-source baseline |\n| **Safe and accurate cooking** | Products meet approved time/temperature, doneness, handling, and cross-contact controls | Raw-source baseline; exact values needed |\n| **Recipe and presentation quality** | Seasoning, portioning, plating, and finished appearance follow approved references | Raw-source baseline; recipes/visuals needed |\n| **Ticket flow** | Grill timing and delays are communicated early enough to protect Expo and adjacent-station coordination | Raw-source baseline |\n| **Clean, controlled station** | The grill and surrounding area remain sanitary and organized through service and close | Raw-source baseline; exact methods needed |\n\nRestaurantOwner’s generic Grill setup guidance supports an organized, fully stocked station and manager line check before peak service. It does not establish Bert’s recipes, pars, doneness, temperatures, layout, or cleaning procedures.[1]\n\n## 3. Opening readiness\n\n| Opening control | Working standard |\n|---|---|\n| **Equipment** | Inspect and start approved Grill equipment; report unsafe or abnormal operation before service |\n| **Tools** | Confirm required tongs, spatulas, thermometers, pans, trays, timers, seasonings, and safety items |\n| **Product** | Confirm approved meats, poultry, vegetables, cheeses, buns, sauces, and finishing items |\n| **Stock and pars** | Compare on-hand product with expected shift demand and disclose shortages early |\n| **Food safety** | Confirm raw/cooked separation, holding/storage condition, labels, dates, rotation, and required test equipment |\n| **Station setup** | Organize cooking, landing, finishing, and handoff flow for efficient peak execution |\n| **Manager line check** | BOH leadership verifies critical product, temperature/readiness, quality, equipment, and shortages before peak |\n\n## 4. During-service ownership\n\n| Service duty | Working standard |\n|---|---|\n| **Cook** | Prepare burgers, chicken, steaks, vegetables, and other approved items to the correct specification |\n| **Control doneness** | Use the approved Bert’s method to achieve requested and required doneness without guessing |\n| **Season and portion** | Follow approved recipe, seasoning, portion, and finishing standards |\n| **Plate/handoff** | Present and communicate completed items according to Expo and shared-ticket timing |\n| **Protect food safety** | Maintain raw/cooked separation, clean utensils and contact surfaces as required, and follow approved temperature controls |\n| **Maintain readiness** | Refill product and reset tools before a shortage or disorganization becomes a service failure |\n| **Communicate** | Report long cook times, shortages, bad product, equipment problems, remakes, or a developing bottleneck early |\n| **Clean as you work** | Control grease, debris, spills, utensils, pans, and surrounding hazards through the shift |\n\nRoutine Companion interaction is unnecessary during normal service. AI is reserved for a shortage, equipment problem, approved standard clarification, quality exception, help request, or manager assignment.\n\n## 5. Closing additions unique to Grill\n\nThe station inherits the universal BOH close and adds:\n\n| Closing control | Working standard | Status |\n|---|---|---|\n| **Grill product** | Store, cover, label, date, rotate, or dispose of product according to the approved rule | Probable baseline |\n| **Tools and pans** | Wash, sanitize, dry, and put away or stage in the approved location | Probable baseline |\n| **Grill surface/equipment** | Clean approved components and surfaces only by the safe Bert’s/equipment procedure | Raw-source baseline; exact method needed |\n| **Grease/debris controls** | Empty, clean, or secure trays/collectors and surrounding areas by the approved method | Probable baseline; exact method needed |\n| **Equipment overnight state** | Leave equipment shut down, cooling, or operating only by approved rule | Configuration needed |\n| **Assigned area** | Complete surrounding surface, floor, mat, wall/splash, and safety-area cleaning assigned to Grill | Configuration needed |\n| **Release** | Receive checkout and release from the authorized closing leader | Shared-close working pattern |\n\n## 6. Historical stock material\n\nThe recovered PDF listed beef patties, bacon, chicken, pulled pork, hot dogs, cheeses, and buns as prior Grill categories. This is **historical menu evidence**, not a current approved station list or par. Validate it against the current Toast menu and current Grill setup before use.\n\n## 7. Evidence and escalation\n\n| Event | Evidence | Destination |\n|---|---|---|\n| Normal readiness | Short Ready status and line-check verification where required | No escalation |\n| Product shortage | Item/category, on-hand condition, and needed action | BOH leader |\n| Equipment or temperature problem | Equipment, failure type, observed condition, and menu impact | BOH leader / maintenance |\n| Doneness or quality failure | Item, requested/required standard, failed result, correction/remake | BOH Manager |\n| Food-safety concern | Direct alert with available safe evidence | Responsible leader immediately |\n| Failed close or inherited mess | Failed condition and one useful picture | Responsible manager |\n| Repeated pattern | AI summary by station, product, cause, shift, and verifier | GM; owner only when unresolved/systemic |\n\n## 8. Bounded AI examples\n\n> **Arrival:** “You’re assigned to Grill. Confirm equipment, core product, tools, raw/cooked separation, and known shortages.”\n\n> **Quality:** “This item did not meet the approved doneness or presentation standard. Record the item and correction; I’ll surface the pattern if it repeats.”\n\n> **Equipment:** “The Grill equipment is not operating normally. Tell the BOH leader what you observe and which menu items are affected. I cannot authorize a repair workaround.”\n\n> **Close:** “Product secured, tools handled, grill equipment and grease controls completed, assigned area clean, and equipment in the approved overnight state. Ready for verification?”\n\n## 9. Configuration still needed\n\n| Configuration | Source when activated |\n|---|---|\n| Current Grill menu ownership | Toast menu and JMAX review |\n| Product, seasoning, tool, pan, and finishing lists | Current station setup |\n| Shift stock and pars | PMIX, forecast, current counts, manager approval |\n| Grill startup/operating/shutdown method | Manufacturer and Bert’s approved procedure |\n| Recipes, cook times, doneness, temperatures, portions, and presentation | Bert’s recipe/quality/food-safety system |\n| Raw/cooked separation and allergen/cross-contact controls | Bert’s approved food-safety procedure |\n| Grill, grease, surrounding-area, and floor cleaning method | Bert’s approved sanitation procedure |\n| Authorized verifier | Manager schedule/capability assignment |\n\n## Review instruction\n\nMark purpose, outcomes, opening, service, closing, and evidence **KEEP, CHANGE, or DELETE**. Review the historical Grill stock categories separately; they are not treated as current policy.\n\n## Reference\n\n[1]: https://www.restaurantowner.com/members/Station-Setup-Line-Check-Grill.cfm \"RestaurantOwner — Station Setup and Line Check: Grill\"\n"
    },
    {
      "id": "berts-source-f8ce9d11586f8029",
      "title": "Bert’s Kitchen Manager Module — v1",
      "filename": "Bert’s Kitchen Manager Module — v1.md",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "BOH leadership"
      ],
      "roles": [
        "Kitchen Manager"
      ],
      "documentType": "Manager workflow",
      "operationalUse": [
        "Reference only"
      ],
      "assignment": "Kitchen Manager preparation, service and handoff",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "draft",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Bert’s Kitchen Manager Module — v1.md",
      "sha256": "f8ce9d11586f802940ef0e2034c9febbc36d395d920ccb56a89a7a3ba08a8968",
      "textSha256": "f8ce9d11586f802940ef0e2034c9febbc36d395d920ccb56a89a7a3ba08a8968",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-c048ed3b29c84fc9",
        "berts-source-ea78f6753e8ec648"
      ],
      "duplicates": [],
      "conflicts": [
        "missing-methods"
      ],
      "content": "# Bert’s Kitchen Manager Module — v1\n\n**Primary JMAX source:** Raw Source 002 — Kitchen Manager Checklist  \n**Secondary sources:** Source 007 management-control drafts; RestaurantOwner Kitchen Manager systems guidance  \n**Status:** Working review baseline; no software build authorized\n\n## 1. Role purpose\n\nThe Kitchen Manager owns BOH readiness, food quality, staffing execution, station standards, stock visibility, cleaning accountability, labor response, manager communication, and employee connection for the assigned shifts. The role should create a kitchen that runs through visible systems rather than personal heroics.\n\nThe Kitchen Manager operates within the assigned restaurant and BOH scope. Access is granted through explicit capabilities and entity/department scope—not the title alone.\n\n## 2. Kitchen Manager-owned outcomes\n\n| Outcome | Definition of done | Source status |\n|---|---|---|\n| **Coverage and deployment** | Upcoming BOH shifts are covered, assignments and skill risks are visible, call-ins/switches are coordinated, and labor is adjusted without breaking required coverage | Raw-source baseline |\n| **Food quality** | Bad or nonstandard food is corrected before reaching the guest, recurring quality drift is identified, and stations receive specific feedback | Raw-source baseline |\n| **Station readiness** | Every assigned station is checked before peak for stock, cleanliness, equipment, product condition, and known risks | Raw-source/RestaurantOwner baseline |\n| **Stock and inventory control** | Freezers and walk-in are checked daily; refill, organization, shortage, par, waste, and product-needs actions have owners | Raw-source and recovered-draft baseline |\n| **Cleaning accountability** | Required cleaning is assigned, completed, verified, and not merely initialed without evidence | Raw-source baseline |\n| **Labor control** | Labor is reviewed against forecast and current sales; release decisions occur while action is still possible | Raw-source and recovered-draft baseline; exact target not confirmed |\n| **Communication and people** | Specials, call-ins, switches, assignments, feedback, and BOH/FOH dependencies are communicated; staff are acknowledged and heard | Raw-source baseline |\n| **Owner independence** | Routine kitchen exceptions are resolved at the correct management level; owners receive only unresolved, repeated, systemic, or serious issues | Confirmed product direction |\n\nRestaurantOwner’s generic guidance supports role-specific duties, ordered opening/shift-change/closing standards, preshift line checks, recipe references, station prep lists, FIFO/labeling, inventory controls, and hands-on training. These are useful control categories, not automatically approved Bert’s procedures.[1]\n\n## 3. Decision authority\n\n| Kitchen Manager may | Kitchen Manager may not without higher approval |\n|---|---|\n| Reject and correct food that fails the approved quality standard | Change recipes, portions, menu standards, or approved safety controls |\n| Assign and reassign BOH work, cleaning, station coverage, and recovery actions within authorized staffing | Change pay rates, expose individual rates, or promise compensation changes |\n| Coordinate call-in coverage and schedule fixes within approved rules | Create unrestricted overtime or violate availability/qualification rules without escalation |\n| Release employees when forecast, actual demand, station readiness, and skill coverage support the decision | Cut below required safety, service, closing, or leadership coverage |\n| Route equipment, product, vendor, or facility problems to the responsible workflow | Authorize major purchases or unsafe workarounds outside delegated limits |\n| Coach and document execution against written standards | Improvise disciplinary, termination, legal, or HR decisions beyond delegated authority |\n\n**Configuration needed:** final scheduling, release, overtime, purchasing, corrective-action, and equipment-shutdown authority.\n\n## 4. Operating cadence\n\n### One to two days before the shift\n\n| Control | Working expectation |\n|---|---|\n| **Coverage** | Check upcoming BOH shifts for unfilled, released, call-off, availability, qualification, and overtime risks |\n| **Station plan** | Identify likely station assignments from forecast volume and proficiency; flag where an ace, trainer, or backup is required |\n| **Product/maintenance risk** | Review known shortages, deliveries, equipment issues, and special events that may affect readiness |\n\nThe raw checklist says the schedule is completed and entered into Sling every Monday. That is **legacy/location-specific wording**, not the normalized requirement. Bert’s currently uses HotSchedules, Rudd’s uses Sling, and the long-term JMAX objective is to own scheduling. The current requirement is simply: publish the approved schedule by the agreed deadline in the current authoritative system.\n\n### Daily opening and preshift\n\n| Control | Working expectation |\n|---|---|\n| **Staffing** | Confirm who is present, late, absent, incoming, released, or approaching overtime |\n| **Specials/events** | Communicate approved specials, parties, menu changes, and service risks to BOH and FOH |\n| **Walk-in/freezer** | Check organization, stock, high-risk shortages, product condition, labeling, rotation, and assigned refill actions |\n| **Station line check** | Personally verify each critical station’s stock, cleanliness, product, equipment, temperature, and readiness before peak |\n| **Cleaning plan** | Review due cleaning; confirm one owner and one verifier for each required task |\n| **Shift plan** | Confirm station assignments, trainer/trainee needs, Float coverage, breaks, call-off response, and escalation path |\n\n### During service\n\n| Control | Working expectation |\n|---|---|\n| **Floor presence** | Remain available to observe quality, timing, stock, cleanliness, and team condition; do not manage only from the office |\n| **Quality correction** | Send failed food back, name the failed standard, and coach the cause rather than quietly remaking everything personally |\n| **Station checks** | Revisit stations at risk-weighted intervals; frequency should reflect volume, prior failures, product risk, and current performance |\n| **Labor response** | Review forecast versus actual sales, current labor, incoming coverage, and overtime before releasing people |\n| **Communication** | Coordinate call-ins, switches, assignments, shortages, equipment issues, and shared BOH/FOH dependencies with other managers |\n| **Phone coverage** | Ensure the required restaurant phone or order channel is assigned and answered; do not assume “somebody” owns it |\n| **Employee connection** | Acknowledge staff, ask useful questions, hear problems, and avoid making employees feel invisible |\n| **Delegate visibly** | Assign the next action, owner, and due time; verify completion instead of absorbing every failure personally |\n\n### Shift change and close\n\n| Control | Working expectation |\n|---|---|\n| **Station handoffs** | Confirm outgoing stations communicate actual condition and incoming staff accept or dispute it |\n| **Station checkout** | Ensure every station is physically verified and released by an authorized named leader |\n| **Waste/quality** | Review significant waste, remakes, bad product, and recurring quality causes |\n| **Stock/pars** | Record shortages, on-hand risks, prep/ordering needs, and problems the next shift must inherit |\n| **Cleaning** | Confirm due cleaning and high-risk closing work are complete; do not accept meaningless initials |\n| **Unresolved work** | Every issue has a named next action, owner, due time, and escalation level |\n\n## 5. Labor control\n\nThe raw source identifies **22% daily labor** as a critical target. Preserve it as a target candidate; do not hard-code it until Jason and Rudd confirm whether it applies to Bert’s, Rudd’s, both, or specific dayparts/days.\n\nThe normalized labor decision should consider:\n\n| Input | Why it matters |\n|---|---|\n| Forecast and actual sales | Determines whether volume is landing as planned |\n| Current and scheduled labor hours | Shows controllable exposure |\n| Skill/station coverage | Prevents cutting the only qualified person for a critical station |\n| Incoming staff and released shifts | Prevents a short-term cut from creating a later failure |\n| Overtime forecast | Enables action before the employee crosses the threshold |\n| Active prep, closing, and safety work | Prevents leaving mandatory work uncovered |\n\nThe Companion should recommend actions and consequences; the authorized human decides the release.\n\n## 6. Food quality and line-check standard\n\nThe Kitchen Manager personally owns the quality-control loop:\n\n1. Verify product condition, stock, and critical temperatures before service.\n2. Reject food that fails an approved standard.\n3. Name the failed standard—recipe, portion, doneness, hold, freshness, temperature, or presentation.\n4. Require the responsible station to correct the failure when operationally safe, rather than silently repairing everything.\n5. Record significant or repeating causes; do not burden the system with every normal correction.\n6. Coach the pattern and verify improvement on a later shift.\n\nStation-specific recipes, visual references, pars, and temperatures remain configuration content.\n\n## 7. Cleaning accountability\n\nInitials alone are not proof. The Kitchen Manager ensures:\n\n| Step | Working expectation |\n|---|---|\n| **Assign** | One employee or role owns each due task |\n| **Define** | The checklist states what complete means, not merely “clean cooler” |\n| **Complete** | The employee records completion at the appropriate time |\n| **Verify** | A named leader physically verifies risk-weighted or required items |\n| **Correct** | Failed work is returned to the responsible person when possible |\n| **Escalate** | Repeated misses, unsafe conditions, or ignored assignments rise through the management ladder |\n\n## 8. Bounded AI and manager scorecard\n\nThe Kitchen Manager receives an operational Copilot—not an unrestricted general assistant and not a card wall.\n\n### Pre-shift example\n\n> “Two BOH risks today: Grill coverage is Level 3 during the forecasted peak, and Fry is short one approved product. Walter reaches overtime at 8:40 p.m. Here are the available actions.”\n\n### During-shift example\n\n> “Ticket time and remake exceptions are clustering on Fry. The station has not reported an equipment problem. Do you want the line-check result and last correction history?”\n\n### Close example\n\n> “Nine stations required checkout. Seven passed. Sandwich needs a second verification; Dish reported abandoned Prep work from Grill. Assign owners before release.”\n\nThe scorecard should emphasize exceptions that can be acted on:\n\n| Measure | Purpose |\n|---|---|\n| Coverage and station-assignment risk | Prevent underqualified or uncovered shifts |\n| Preshift line-check completion and failures | Measure readiness, not form completion |\n| Labor versus approved target and forecast | Support timely deployment decisions |\n| Overtime exposure | Prevent avoidable premium labor |\n| Station checkout/handoff disputes | Identify recurring ownership failures |\n| Quality/remake/waste patterns | Focus coaching and cost control |\n| Cleaning misses and repeat verifier failures | Test whether standards are enforced |\n| Unresolved issues by owner/due time | Prevent problems from disappearing |\n| Staff check-ins and coaching commitments | Ensure people are not invisible |\n\n## 9. Evidence and escalation\n\n| Event | First destination | Escalates when |\n|---|---|---|\n| Normal station correction | Responsible Team Member and KM | Repeated or standard is unclear |\n| Staffing/coverage problem | KM/GM | No qualified solution within authority |\n| Labor risk | KM/GM | Target cannot be met without service/safety impact |\n| Equipment or stock problem | Assigned manager/vendor workflow | Service impact, overdue resolution, or major spend |\n| Food-safety risk | Responsible senior manager immediately | According to approved safety policy |\n| Repeated checkout/cleaning failure | KM, then GM | Coaching fails or verifier ignores pattern |\n| Systemic or unresolved management failure | GM | Owner action required |\n\nOwners receive compressed patterns and overdue management failures—not every station picture, line-check miss, or staff note.\n\n## 10. Configuration and conflict register\n\n| Item | Current status |\n|---|---|\n| Schedule platform and Monday deadline | Legacy/location-specific wording; configure by restaurant during transition |\n| 22% labor target | Candidate target; applicability unconfirmed |\n| Station-check frequency | Risk-based working design; exact minimum may be defined later |\n| Phone/channel ownership | Valid responsibility; exact channel and assigned position needed |\n| Daily-special communication method | Valid duty; FOH/BOH recipients and timing needed |\n| Ordering authority | Recovered leadership material indicates broader management ownership; exact KM capability needed |\n| Named current Kitchen Managers | Recovered PDF lists Jeff and Ryan; validate when assigning users, not in the generic role standard |\n| Corrective-action authority | Not final |\n| Major purchase and emergency-spend authority | Not final |\n| Individual pay visibility | Confirmed hidden below owner; KM uses labor guidance without rendering rates |\n\n## Review instruction\n\nMark role purpose, outcomes, authority, cadence, labor, quality, cleaning, AI/scorecard, and escalation **KEEP, CHANGE, or DELETE**. Confirm the schedule deadline/platform and 22% labor target separately; neither is hard-coded as current JMAX policy.\n\n## Reference\n\n[1]: https://www.restaurantowner.com/members/Becoming-a-Great-Kitchen-Manager.cfm \"RestaurantOwner — How to Develop a Great Kitchen Manager\"\n"
    },
    {
      "id": "berts-source-0b44b5698e3dd208",
      "title": "Bert’s Pizza   Oven Station Module — v1",
      "filename": "Bert’s Pizza _ Oven Station Module — v1.md",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "Pizza / Oven"
      ],
      "roles": [
        "Cook"
      ],
      "documentType": "Station SOP",
      "operationalUse": [
        "Training source",
        "Opening / closing"
      ],
      "assignment": "Cook · Pizza / Oven",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "draft",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Bert’s Pizza _ Oven Station Module — v1.md",
      "sha256": "0b44b5698e3dd208ebb752c7a9024feeb3d39b2cfe6cf16f22e2e6929aa9ccc8",
      "textSha256": "0b44b5698e3dd208ebb752c7a9024feeb3d39b2cfe6cf16f22e2e6929aa9ccc8",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-907730c0da0f5a04",
        "berts-source-5c4abd3e324c8827",
        "berts-source-33e78221f2adffbf",
        "berts-source-67d68d064444ee1c",
        "berts-source-56e67ec0d8a7d48f"
      ],
      "duplicates": [],
      "conflicts": [
        "station-boundaries",
        "missing-methods",
        "canonical-pizza"
      ],
      "content": "# Bert’s Pizza / Oven Station Module — v1\n\n**Inherits:** `Berts_Shared_BOH_Core_Standard_v1.md`  \n**Primary JMAX source:** Raw Source 004 — Oven / Pizza & Oven Station Team Member  \n**Secondary source:** Source 007 recovered stock and Mac Bowl workflow material  \n**Status:** Working review baseline; no software build authorized\n\n## 1. Station purpose\n\nThe Pizza/Oven assignment prepares, bakes, finishes, and releases approved pizzas and other oven-finished menu items according to Bert’s recipe, bake, quality, timing, and presentation standards. The station maintains safe oven operation, organized flow, accurate doneness, and a complete close.\n\nPizza/Oven is a station proficiency and shift assignment under BOH/Cook, not a separate permission tier.\n\n## 2. Owned outcomes\n\n| Outcome | Definition of done | Status |\n|---|---|---|\n| **Oven readiness** | The oven is preheated and maintained at the approved operating condition for current menu items | Raw-source baseline; equipment values needed |\n| **Ingredient and build readiness** | Approved dough, toppings, sauces, pans/screens, tools, and assembled items are ready without abandoned prep work | Raw-source baseline |\n| **Bake quality** | Items meet approved bake time, doneness, appearance, portion, and presentation standards | Raw-source baseline; recipe references needed |\n| **Ticket flow** | Bakes are sequenced, monitored, removed promptly, and communicated to Expo/adjacent stations | Probable baseline |\n| **Safe, clean close** | Oven area, tools, surfaces, product, and equipment are left in the approved overnight condition and verified | Raw-source/shared-close baseline |\n\n## 3. Opening readiness\n\n| Opening control | Working standard |\n|---|---|\n| **Oven** | Inspect and preheat the approved oven equipment; report unsafe or abnormal operation before service |\n| **Bake tools** | Confirm required screens, pans, peels, cutters, gloves, utensils, and landing space |\n| **Dough and product** | Confirm usable dough and approved toppings/sauces; check labels, dates, rotation, and freshness |\n| **Station stock** | Check required on-hand items against the approved shift need and disclose shortages early |\n| **Setup** | Organize build, oven, finishing, and handoff flow so active and completed items do not become confused |\n| **Line check** | BOH leadership verifies critical stock, product condition, oven readiness, and known shift volume |\n\n## 4. During-service ownership\n\n| Service duty | Working standard |\n|---|---|\n| **Build** | Prepare dough, toppings, sauces, and assembled items using approved recipes, portions, and sequence |\n| **Bake** | Load, rotate, monitor, and remove items according to the item-specific standard |\n| **Finish** | Confirm doneness, appearance, cut/finish, portion, and presentation before handoff |\n| **Communicate** | Coordinate timing with Sandwich, Expo, and other stations for items requiring shared production |\n| **Maintain readiness** | Refill stock and reset tools before a shortage or clutter becomes a ticket-flow failure |\n| **Clean as you work** | Control flour, toppings, sauce, screens/pans, crumbs, utensils, and unsafe buildup |\n| **Escalate** | Report oven, stock, quality, timing, or staffing problems early |\n\nThe Companion remains quiet during normal service. It is available for an equipment problem, shortage, quality clarification, shared-item ownership issue, or manager assignment.\n\n## 5. Closing additions unique to Pizza/Oven\n\nThe station inherits the universal BOH close and adds:\n\n| Closing control | Working standard | Status |\n|---|---|---|\n| **Dough and toppings** | Store, cover, label, date, rotate, and leave in the approved condition | Probable baseline |\n| **Sauces and cold rail** | Secure product and clean containers/surfaces using the approved method | Probable baseline |\n| **Screens, pans, peels, cutters, and tools** | Wash, sanitize, air-dry where required, and put away or stage in the approved location | Probable baseline |\n| **Oven area** | Remove food debris and clean approved surfaces after the equipment reaches the safe cleaning condition | Raw-source baseline; manufacturer method needed |\n| **Oven overnight state** | Leave on, cool, shut down, or clean only according to approved Bert’s/equipment procedure | Configuration needed |\n| **Shared-item transfer** | Complete or explicitly transfer any active shared production before release | Shared-close baseline |\n| **Release** | Receive approval from the authorized closing leader before clock-out | Shared-close working pattern |\n\n## 6. Historical stock and workflow material\n\nThe recovered PDF listed dough, cheeses, meats, vegetables, ranch, buffalo sauce, and BBQ sauce as prior Pizza stock categories. These are **historical menu prompts**, not a current item list or par.\n\nA recovered Mac Bowl draft proposed that Sandwich assemble bowls, Pizza bake/finish them, and Expo receive them. It referenced macaroni, marinara, garlic butter, Alfredo, buffalo/BBQ sauces, tins, oven screens/pans, and a cold rail. This workflow is **not approved by this module**. It should be confirmed or deleted when the current menu and line flow are reviewed.\n\nThe raw source also includes baked sandwiches in Pizza/Oven’s scope, while Bert’s separately recognizes Sandwich. Final ownership of baked sandwiches requires current operating confirmation; the module does not silently merge the stations.\n\n## 7. Evidence and escalation\n\n| Event | Evidence | Destination |\n|---|---|---|\n| Normal readiness | Short Ready status and line-check verification where required | No escalation |\n| Missing dough/product/tool | Item/category, current condition, and needed action | BOH leader |\n| Oven problem | Equipment, failure type, current temperature/behavior if known, and service impact | BOH leader / maintenance |\n| Quality failure | Item, failed bake/presentation standard, correction/remake | BOH Manager |\n| Shared-workflow breakdown | Item, expected station owner, current location/status | Responsible manager |\n| Failed close or inherited mess | Failed condition and one useful picture | Responsible manager |\n| Repeated or unresolved pattern | AI summary by station, shift, cause, and verifier | GM; owner only when unresolved/systemic |\n\n## 8. Bounded AI examples\n\n> **Arrival:** “You’re assigned to Pizza/Oven. Confirm oven readiness, dough/product, bake tools, and known shortages.”\n\n> **Equipment issue:** “The oven is not holding the approved condition. Stop guessing and tell the BOH leader what the oven is doing and which menu items are affected.”\n\n> **Shared item:** “This item crosses Sandwich and Pizza. Who currently owns the build, bake, and handoff? I’ll record the unresolved ownership for the manager.”\n\n> **Close:** “Product secured, tools and screens handled, oven area cleaned, equipment in the approved overnight state, and active work transferred. Ready for verification?”\n\n## 9. Configuration still needed\n\n| Configuration | Source when activated |\n|---|---|\n| Current Pizza/Oven menu ownership | Toast menu and JMAX review |\n| Baked-sandwich ownership | Current line practice and manager approval |\n| Oven startup, operating, shutdown, and cleaning procedure | Manufacturer and Bert’s approved procedure |\n| Dough, topping, sauce, tool, and pan/screen lists | Current station setup |\n| Recipes, portions, bake times, doneness, and presentation | Bert’s recipe/quality system |\n| Shift stock and pars | PMIX, forecast, current counts, manager approval |\n| Mac Bowl workflow | Current menu and station-flow decision |\n| Authorized verifier | Manager schedule/capability assignment |\n\n## Review instruction\n\nMark purpose, outcomes, opening, service, closing, and evidence **KEEP, CHANGE, or DELETE**. Review baked-sandwich ownership, historical Pizza stock, and the Mac Bowl workflow separately; none is treated as confirmed current policy.\n"
    },
    {
      "id": "berts-source-51b6cb7c7b3cfdb9",
      "title": "Bert’s Sandwich Station Module — v1",
      "filename": "Bert’s Sandwich Station Module — v1.md",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "Sandwich"
      ],
      "roles": [
        "Cook"
      ],
      "documentType": "Station SOP",
      "operationalUse": [
        "Training source",
        "Opening / closing"
      ],
      "assignment": "Cook · Sandwich",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "draft",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Bert’s Sandwich Station Module — v1.md",
      "sha256": "51b6cb7c7b3cfdb92507da33572e9ad442d48aa7eca992651ff6c421617fc488",
      "textSha256": "51b6cb7c7b3cfdb92507da33572e9ad442d48aa7eca992651ff6c421617fc488",
      "capturedAt": "2026-09-10",
      "relatedVersions": [],
      "duplicates": [],
      "conflicts": [
        "station-boundaries",
        "missing-methods"
      ],
      "content": "# Bert’s Sandwich Station Module — v1\n\n**Inherits:** `Berts_Shared_BOH_Core_Standard_v1.md`  \n**Primary JMAX source:** Raw Source 001 — Daily Sandwich  \n**Secondary source:** Source 007 recovered historical stock and workflow material  \n**Status:** Working review baseline; no software build authorized\n\n## 1. Station purpose\n\nThe Sandwich assignment prepares and completes approved sandwich-station items to Bert’s recipe, portion, timing, and presentation standards while maintaining readiness, stock, sanitation, and a responsible close.\n\nPizza/Oven, Sandwich, Fry, Grill, and Flat Top are station assignments under BOH/Cook. Sandwich is not a separate permission tier.\n\n## 2. Sandwich-owned outcomes\n\n| Outcome | Definition of done | Status |\n|---|---|---|\n| **Ready before service** | Equipment is on and operating, the table and under-counter storage are stocked, and enough bread is pulled for expected shift volume | Raw-source baseline |\n| **Continuous stock** | Core sandwich ingredients, bread, pasta sauce, and assigned packaging remain available through service | Raw-source baseline |\n| **Recipe and quality execution** | Items follow approved recipes, portions, temperatures, timing, and presentation | Shared BOH baseline; configuration needed |\n| **Clean, organized equipment** | Toaster, microwaves, lowboy interior/doors, sandwich table interior, and work surfaces meet the approved cleaning condition | Raw-source baseline; methods needed |\n| **Responsible close** | Product is secured, equipment is left in the approved overnight condition, the station is reset, and an authorized manager releases the employee | Raw-source and shared-close baseline |\n\n## 3. Opening readiness\n\n| Opening control | Working standard | Source status |\n|---|---|---|\n| **Equipment** | Check required Sandwich equipment and turn on equipment approved for startup | Raw source |\n| **Station stock** | Check the sandwich table and storage underneath; identify shortages before service | Raw source |\n| **Bread** | Pull enough bread for expected shift volume and help maintain bread racks in the walk-in | Raw source |\n| **Ingredients** | Confirm assigned cheeses, meats, tomatoes, slaw, lettuce, bacon, sauces, and other approved station items | Raw source examples; current item list needed |\n| **Pasta sauce** | Confirm the correct pan/container and sufficient ready product; refill or replace by approved rule | Raw source; method needed |\n| **Work area** | Confirm clean food-contact surfaces, usable tools, labels/dates, and organized flow | Shared BOH baseline |\n| **Manager verification** | Shortages, bad product, or equipment problems are disclosed during the preshift line check | Shared BOH baseline |\n\nThe Companion should not ask the employee to manually count every item when Toast demand, pars, or a manager line check can narrow the request to exceptions.\n\n## 4. During-service ownership\n\n| Service duty | Working standard |\n|---|---|\n| **Maintain stock** | Refill assigned ingredients before the station runs out; raise unavailable product early |\n| **Bread flow** | Keep usable bread available at the station and support approved walk-in bread-rack stocking |\n| **Pasta sauce** | Refill or switch the sauce container using the approved food-safety and quality method |\n| **To-go boxes** | Serve as backup stocker when assigned; do not abandon Sandwich execution to perform the support task |\n| **Quality** | Follow Bert’s recipe, portion, timing, temperature, and presentation references |\n| **Clean as you work** | Control crumbs, spills, containers, utensils, product debris, and unsafe buildup |\n| **Communication** | Tell Expo/BOH leadership about shortages, bad product, equipment failure, or a developing bottleneck before ticket flow fails |\n\nRoutine Companion use during service should be limited to a real exception, help request, required control, or direct manager assignment.\n\n## 5. Closing additions unique to Sandwich\n\nThe Sandwich station inherits the universal BOH close and adds:\n\n| Closing control | Working standard | Source status |\n|---|---|---|\n| **Toaster** | Clean according to the approved shutdown, cooling, crumb, and surface procedure | Raw source; exact method needed |\n| **Microwaves** | Clean approved interior and exterior surfaces | Raw source; method needed |\n| **Lowboy** | Clean interior and doors without leaving unsafe product or temperature exposure | Raw source; method needed |\n| **Sandwich table** | Flip/transfer product by the approved rule; clean the interior and all station surfaces | Raw source; exact “flip” method needed |\n| **Product protection** | Cover or otherwise secure the sandwich table/product by the approved overnight method | Raw source; exact definition needed |\n| **Equipment** | Turn off only equipment approved for shutdown | Raw source; equipment list needed |\n| **Release** | Check with and receive release from the authorized manager before clock-out | Raw source |\n\n## 6. Historical material retained for validation\n\nThe recovered PDF contained a prior Sandwich stock draft: produce, pickles, deli meats, meatballs, cheeses, rolls, sauces, hot dogs, and salad toppings. This list is **historical**, not the current approved station inventory. It should be compared with the current Toast menu, current line setup, and current manager practice before becoming a par list.\n\nThe recovered Mac Bowl draft proposed that Sandwich build bowls while Pizza baked/finished them and Expo received them. This remains a **legacy workflow candidate** until confirmed against the current menu and line flow.\n\n## 7. Evidence and escalation\n\n| Event | Evidence | Destination |\n|---|---|---|\n| Normal station ready | Short Ready status; manager line check where required | No escalation |\n| Stock shortage | Item/category, on-hand condition, and needed action | BOH leader |\n| Bad product or quality failure | Product, failed standard, and correction; photo only if useful | BOH Manager |\n| Equipment problem | Equipment, failure type, and operating impact | BOH leader / maintenance workflow |\n| Failed close or inherited mess | Failed condition and one useful picture | Responsible manager |\n| Repeated unresolved pattern | AI summary by station, shift, employee, verifier, and recurrence | GM; owner only if unresolved/systemic |\n\n## 8. Bounded AI examples\n\n> **Arrival:** “You’re assigned to Sandwich. Equipment, bread, and station stock are the three readiness checks. What is missing?”\n\n> **Shortage:** “Bread is below tonight’s requirement. Is product available in the walk-in, unavailable, or waiting on another station?”\n\n> **Close:** “Before checkout: toaster and microwaves cleaned, lowboy and sandwich table reset, product secured, and approved equipment off. Ready for manager verification?”\n\nThe Sandwich employee does not receive an unrestricted general chatbot.\n\n## 9. Configuration still needed\n\n| Configuration | Source when activated |\n|---|---|\n| Current Sandwich menu and station ownership | Toast menu and JMAX review |\n| Exact ingredients and closing pars | Current station count, PMIX, forecast, and manager approval |\n| Bread-pull method by shift volume | Sales history, current practice, and manager approval |\n| Pasta-sauce refill/switch rule | Bert’s recipe, holding, and sanitation procedure |\n| Toaster, microwave, lowboy, and sandwich-table cleaning methods | Equipment and Bert’s approved sanitation procedure |\n| Definition of “flip” and “cover sandwich table” | Current operator demonstration |\n| Mac Bowl ownership | Current menu and line-flow confirmation |\n| Authorized verifier | Manager schedule/capability assignment |\n\n## Review instruction\n\nMark the purpose, outcomes, opening, service, closing, and evidence sections **KEEP, CHANGE, or DELETE**. The historical stock and Mac Bowl material should be confirmed or rejected separately; neither is treated as current policy.\n"
    },
    {
      "id": "berts-source-c048ed3b29c84fc9",
      "title": "Berts Kitchen Manager Reconciliation v2",
      "filename": "Berts_Kitchen_Manager_Reconciliation_v2.md",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "BOH leadership"
      ],
      "roles": [
        "Kitchen Manager"
      ],
      "documentType": "Manager workflow",
      "operationalUse": [
        "Reference only"
      ],
      "assignment": "Kitchen Manager preparation, service and handoff",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "draft",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_Kitchen_Manager_Reconciliation_v2.md",
      "sha256": "c048ed3b29c84fc9b6b8c95fd9453d5e8401b9b6f38165ce61723eb00ea91152",
      "textSha256": "c048ed3b29c84fc9b6b8c95fd9453d5e8401b9b6f38165ce61723eb00ea91152",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-f8ce9d11586f8029",
        "berts-source-ea78f6753e8ec648"
      ],
      "duplicates": [],
      "conflicts": [],
      "content": "# Bert’s Kitchen Management and J Max — Reconciliation v2\n\n**Status:** Owner-review working document.  \n**Scope:** Bert’s Hometown Grill & Pizzeria only.  \n**Purpose:** Reconcile the Bert’s Operating Knowledge Base v1 with the uploaded Kitchen Management Expectations, Kitchen Management Manual, prior J Max working definition, and RestaurantOwner.com readiness research. No unresolved claim in this document is enforceable policy.\n\n## Executive Conclusion\n\nThe sources agree on the central operating idea:\n\n> **A strong kitchen manager prevents the shift from becoming survival mode by creating readiness before volume, keeping leadership present during volume, and leaving verified reality—not hidden work—for the next shift.**\n\nThe sources do not support turning that idea into a single static “manager checklist.” They define a **time-bound management control loop**. J Max should be the system that assembles the relevant facts, routes the work to the lowest capable person, records accountability and handoff condition, and escalates only unresolved exceptions.\n\n## Where the Sources Align\n\n| Control area | Bert’s Knowledge Base v1 | Kitchen Management Expectations | RestaurantOwner.com validation | J Max implication |\n|---|---|---|---|---|\n| Pre-shift prevention | Strong 3:00 p.m. readiness pattern; manager must have actual capacity to prepare | Night manager huddles with incoming closer; checks staffing/projection; line check by 4:30; sets prep/sanitation priorities | Line readiness and planned huddle must precede service | J Max works backward from the actual demand window; it does not impose a blind universal time |\n| Station readiness | Physical line check, labels, rotation, product, prep, staffing, sanitation, Float, and escalation | Product, fit-for-service, chemicals, towels, special, prep, night stock all checked | Pars and temperatures are central pre-shift checks | J Max retrieves exceptions and records ready/FIX state by station |\n| Manager presence | Stay present during service; recheck risk stations; adjust labor before opportunity passes | Manager works line quality, ticket time, and support through volume | Manager shift card keeps leaders on the floor instead of in the office | J Max gives a short live brief and only actionable alerts |\n| Closing and next-shift protection | Verified outgoing/incoming condition; no quiet patch; named owner, due time, escalation | Pre-close early-outs; inspect stations before release; next-day prep/notes; check dish and equipment | Closing should set the restaurant up for tomorrow | J Max checkout/handoff is the strongest first operating loop |\n| Leadership development | Managers verify and develop rather than personally perform everything | Delegate, inspect, and help when needed | Strong staff leaders can own defined areas; manager models accountability | J Max distinguishes assignment, station proficiency, and authority capability |\n| Checklist design | Structured PASS/FIX controls; exception photos, not continuous surveillance | Time-bounded task inventory | Overly long lists become performative and get skipped | Conversation gives context; short structured controls confirm known-answer actions |\n\n## The Reconciled Bert’s Kitchen-Manager Rhythm\n\nThe source documents contain two time styles: fixed historical time references and outcome-based readiness requirements. J Max must preserve the requirement, then configure the time by daypart, expected volume, events, staffing, and each location’s actual operating clock.\n\n| Operating moment | Required manager outcome | J Max source inputs | J Max support |\n|---|---|---|---|\n| **Opening / receiving** | Product received/rotated; defects and overstock identified; critical prep directed; sanitation and special checked; station work begins | Delivery records, inventory/pars, projected sales, prior notes, maintenance, special/event data | “Truck has two missing items; wings are below projected need; direct first prep before normal work.” |\n| **Before lunch** | Critical line is fit for service; sanitation and dish conditions are verified; coverage and breaks remain viable | Station readiness, temps/chemicals, employees clocked in, forecast, early alerts | Exception-only lunch readiness prompt |\n| **Between dayparts** | Dough and other time-bound production begins early enough; unresolved work becomes named/owned rather than assumed | Prep progress, sales forecast, actual volume, staffing schedule | Deadline/capacity alert routed to the responsible leader |\n| **Night preflight** | Incoming leadership has a plan; coverage, readiness, sanitation, stock, prep, events, and likely volume risk are addressed before rush | Schedule/punch mismatch, forecast, parties, 86s, inventory, previous handoff, unresolved exceptions, labor/OT | Conversation-led private preflight; the huddle only begins after key risks have an owner |\n| **Service** | Manager stays visible, protects quality, monitors ticket-time deterioration, deploys labor, and helps only without hiding accountable failures | Ticket-time trend, sales pace, open checks, station issues, labor/OT, employee requests | A few actionable recommendations—not surveys or card walls |\n| **Close** | Early-outs are structured; Dish does not collapse; each station is checked out; next-day prep, notes, and unresolved work are owned | Current volume, staffing exits, dish condition, checkout status, tomorrow’s forecast, maintenance/issues | Soft operational checkout gate, handoff, exception evidence, and escalation |\n\n## Decisions Already Supported by Bert’s Source Material\n\nThe following current J Max concepts are strengthened—not replaced—by the uploaded Bert’s sources.\n\n| J Max rule | Support found |\n|---|---|\n| Conversation-first, structured-control second | Knowledge Base specifies conversation for context/ambiguity and PASS/FIX for repetitive known answers |\n| No generic full-time employee chatbot during service | Knowledge Base requires bounded team-member experience; manager/owner AI depth varies by capability |\n| Schedule remains source-of-truth in HotSchedules during transition | Knowledge Base records HotSchedules as Bert’s current scheduling authority and prohibits dual entry |\n| Toast is read/interpret/route, not the permanent operating brain | Knowledge Base aligns with existing Toast read-only boundary |\n| Checkout is a soft operational gate, never a time-clock lock | Knowledge Base confirms Toast clock-out remains separate |\n| Exception evidence is not surveillance | Knowledge Base explicitly rejects routine photos and favors targeted support for disputes/failures |\n| Owners receive systemic and unresolved work, not station noise | Lowest-capable-escalation rule is explicit |\n| A manager must not quietly repair a recurring failure | Both manager control and handoff material require named correction, verification, and escalation |\n\n## Conflicts and Gaps Requiring a Human Decision\n\nThe Knowledge Base correctly requires J Max to show a conflict rather than silently choose. These are the current material items.\n\n| ID | Topic | Current competing source claims | Why it matters | Proposed handling |\n|---|---|---|---|---|\n| **BKM-001** | Dish checkout verifier | Current Companion working rule: any higher title may approve; Shift Lead/Master may self-check an earned station. Knowledge Base: Dish requires one specifically assigned BOH Manager, Shift Leader, or authorized closing manager; “any available manager” is insufficient | Dish is the strongest existing handoff module; vague verifier authority undermines accountability | Resolve specifically for Dish before extending a broader rule to all stations |\n| **BKM-002** | Station proficiency architecture | Current Companion definition: four stages ending in Trainer/Master. Knowledge Base: five proficiency levels, with training authority separate from mastery; Level 4 or 5 plus Certified Trainer capability may train | Determines schedule eligibility, training authority, sign-off, and self-check privileges | Do not hard-code until the five-level model is recovered or deliberately approved |\n| **BKM-003** | Universal role-template headings | Prior working definition lists 25 named sections. Knowledge Base says only 21 headings were recovered; four canonical section names are missing | Prevents a generated role module from masquerading as the canonical template | Preserve the existing claimed Pizza Make template; recover it or have ownership deliberately name the four missing sections |\n| **BKM-004** | Kitchen-manager time controls | Expectations document uses exact 8:00, 11:00, 2:00, 4:30, 7:30–8:15, and 8:00 times. Knowledge Base uses roughly 3:00/4:00 readiness; RestaurantOwner recommends working backward from actual service | Fixed times may be correct for Bert’s but wrong for specific days or shifts | Treat the outcome as standard and configure time rules by Bert’s daypart/service plan |\n| **BKM-005** | Station ownership map | Kitchen manual assigns some products differently than Knowledge Base’s later role separation; Knowledge Base flags Grill vs. Flat Top, baked sandwiches, and Mac Bowl as unresolved | Cannot create reliable schedule or training plans while products have two station owners | Confirm current menu-to-station mapping before employee-facing operational use |\n| **BKM-006** | Health-code references | Manual says “based on TN Health Codes”; Knowledge Base marks specific compliance values as unvalidated configuration | Safety errors cannot be filled with plausible defaults | Keep reference-only until current equipment, chemical, test, and approved compliance standard are confirmed |\n\n## Immediate Recommendation\n\nDo **not** try to complete every role, station, or kitchen procedure now. The highest-leverage non-build work is to define one **Bert’s verified handoff loop** from an existing strong module, beginning with Dish or the next documented Back Window module. It must have an approved definition of done, named verifier/backup coverage, a short PASS/FIX control, Accept/Dispute arrival handling, and an escalation SLA.\n\nThis directly attacks the daily failure Jason identified: a later shift inheriting a destroyed work area with no evidence, owner, or consequence.\n\n## Next Decision to Resolve\n\nResolve **BKM-001** first: whether Dish has a specifically assigned release authority at each closing shift or whether any higher-titled leader may approve its checkout. The answer determines whether accountability belongs to a named closer or floats to whichever leader happens to be available.\n\n## References\n\n[1]: Bert’s JMAX Operating Knowledge Base — Recovery v1, uploaded August 28, 2026.\n\n[2]: Kitchen Management Expectations, uploaded August 28, 2026.\n\n[3]: Kitchen Management Manual — Styled, uploaded August 28, 2026.\n\n[4]: https://www.restaurantowner.com/public/Restaurant-Line-Checklist-System.cfm \"RestaurantOwner.com — Preshift Line Check\"\n\n[5]: https://www.restaurantowner.com/members/Cleared-for-Takeoff-Systems-Approach-to-Preshift-Meetings.cfm \"RestaurantOwner.com — Cleared for Takeoff: A Systems Approach to Pre-shift Meetings\"\n\n[6]: https://www.restaurantowner.com/public/7-Proven-Practices-to-Conduct-a-Highly-Effective-PreShift-Huddle.cfm \"RestaurantOwner.com — 7 Proven Practices to Conduct a Highly Effective Pre-Shift Huddle\"\n"
    },
    {
      "id": "berts-source-0cbee0e18b2be6ab",
      "title": "Berts Daily Operations",
      "filename": "Berts Daily Operations.docx",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "Management",
      "stations": [
        "Restaurant leadership"
      ],
      "roles": [
        "Owner",
        "General Manager"
      ],
      "documentType": "Operating reference",
      "operationalUse": [
        "Reference only"
      ],
      "assignment": "Owner review and source reconciliation",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts Daily Operations.docx",
      "sha256": "0cbee0e18b2be6ab3d6d9f726416b88ac75bd52a45e40e9179e2249e952fed4d",
      "textSha256": "4c2a42ad95f5968a7ca6a299f04c41a7aa63bedbc4617d9b7365aeea077ea5e3",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-e1134aec3819c332"
      ],
      "duplicates": [],
      "conflicts": [
        "leadership-history"
      ],
      "content": "Bert’s Hometown Grill\nDaily Operations\nHours of operation\nMonday         11:00a.m.-8:30p.m.\nTuesday         11:00a.m.- 8:30p.m.\nWednesday   11:00a.m.-8:30p.m.\nThursday        11:00a.m.-9:00p.m.\nFriday             11:00a.m.-9:30p.m.\nSaturday        11:00a.m.-9:30p.m.\nSunday           11:00a.m.-9:00p.m.\n\nRudd Maxwell – Working in Bert’s for the last 20 years I have helped implement small menu changes, save money on food cost and supplies, last year I introduced a new point of sales system that has already proven a success in speeding up inputting orders, phone orders, customer checkout, and back of house sales insights and reporting. It is small changes like this that intend on making as the restaurant evolves with the growing sales.  I do not plan on changing anything on the menu until it is needed, the restaurant runs smoothly and has a very large and committed customer base, it will be my daily goal to keep the same welcoming atmosphere that all our customers love.\n List of tasks performed by all management and owners\nCount bank bags from previous night, set up cash drawer, and go to the bank to pick up change, if needed.\nEnsure everyone arrives for each shift.\nTake inventory and prepare for food truck order every 2 days.\nDuring each shift it is my responsibility to watch over each station and work with my managers to help assist employees in areas needed. \nWork to ensure the restaurant is fully staffed and hire any positions in need.\nChecking on guests’ dining experience\nEmployee evaluations along with taking any disciplinary actions\nMonitoring the cleanliness of the kitchen and dining room daily. Also tracking all aspects of needed maintenance inside and outside of the restaurant\nEnd of day sales reports\n\nDayshift Leadership\nKitchen Manager- Walter Liszeski \nWalter has worked with Bert’s for over 15 years as a kitchen manager. Walter helps with opening the restaurant when the owner is absent. He has full knowledge of counting money and doing food truck orders. During hours of operation he will maintain the quality of food, sanitization of the kitchen, and work aside the dining room manager to keep customers happy and coming back.\nDining Room Manager- Sunshine Brewster\nSunshine has been an employee with Bert’s for 9 years. She has great charisma and always has smiling face. Handling any issues with customer satisfaction efficiently, Sunshine also has access to the safe for money handling to get change for the cashier, knowledge of opening the front of house, expediting food for other waitresses and daily staff scheduling.\n\nNightshift Leadership\nKitchen Manager-Casey Denham \nCasey Has been with Bert’s for 10 years, He started as a dish washer and quickly worked his way up to manager after 5 years of dedication. Casey has been very efficient with food quality and sanitation, helps with weekly scheduling, and will do inventory along with food truck orders. Casey shares in the responsibility of doing the end of day books with the other night managers, Always checks food cooking equipment at the end of each shift and rallies the kitchen in times of extreme business. Has a proven track record of employee and customer satisfaction.\n\nDining Room Manager-Rene Summey\nRene has been with Bert’s for 13 years, she has won awards in Monroe County, TN for best waitress and is a very recognizable face in the community, Rene has access to the bank bags to get change for cashiers, helps with weekly scheduling and front of house hiring and employee evaluations, and ensuring daily customer satisfaction. Rene shares in the responsibility of end of night books and takes bank bags to the bank at the end of all her shifts. \n\nOpening staff key holders- Walter Liszeski, Sunshine Brewster, Rudd Maxwell\nClosing Staff key holders - Casey Denham, Rene Summey, Rudd Maxwell\nBank Bag responsibilities – Rudd Maxwell, Walter Liszeski, Sunshine Brewster, Rene Summey, Casey Denham, Alyssa Maxwell\nFood and supply Ordering – Rudd Maxwell, Casey Denham, Walter Liszeski"
    },
    {
      "id": "berts-source-e1134aec3819c332",
      "title": "Berts Daily Operations-LAPTOP-48MR0AIE",
      "filename": "Berts Daily Operations-LAPTOP-48MR0AIE.docx",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "Management",
      "stations": [
        "Restaurant leadership"
      ],
      "roles": [
        "Owner",
        "General Manager"
      ],
      "documentType": "Operating reference",
      "operationalUse": [
        "Reference only"
      ],
      "assignment": "Owner review and source reconciliation",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts Daily Operations-LAPTOP-48MR0AIE.docx",
      "sha256": "e1134aec3819c332774b77666e602e1f2195c202d4f416765cff6ba470fec481",
      "textSha256": "137f56ad27ba2ed777e6e69a94b36b91f1c36a7245593dc7330abfc2c66e2196",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-0cbee0e18b2be6ab"
      ],
      "duplicates": [],
      "conflicts": [
        "leadership-history"
      ],
      "content": "Bert’s Hometown Grill\nDaily Operations\nHours of operation\nMonday         11:00a.m.-8:30p.m.\nTuesday         11:00a.m.- 8:30p.m.\nWednesday   11:00a.m.-8:30p.m.\nThursday        11:00a.m.-9:00p.m.\nFriday             11:00a.m.-9:30p.m.\nSaturday        11:00a.m.-9:30p.m.\nSunday           11:00a.m.-9:00p.m.\n\nRudd Maxwell – As general manager I will work 5 days a week and be on-call as needed, my daily responsibilities will be as follows.\nArrive at restaurant at 8:15a.m.\nCount bank bags from previous night and set up cash drawer and go to the bank to pick up change if needed\nEnsure everyone arrives for each shift\nTake inventory and prepare for food truck order every 2 days\nAssist in making dough if needed\nIn the hours prior to opening focus on ensuring all vendors are paid and check food pricing to ensure profitability \nDuring each shift it is my responsibility to watch over each station and work with my managers to help any position in need of help, to ensure all customers and employees are satisfied\nEvery Saturday I work on the following weeks work schedule\nWork to ensure the restaurant is fully staffed and hire any positions in need of help\nEmployee evaluations along with taking any disciplinary actions\nMonitoring the cleanliness of the kitchen and dining room daily as well as keeping check on all aspects of needed maintenance inside and outside of the restaurant\nChecking all stations at the end of each shift to ensure all closing duties have been performed\n5 nights a week I will do the end of the day books for the restaurant at the closing of each day\n\nDayshift Leadership\nKitchen Manager- Walter Liszeski \nWalter has worked with Bert’s for over 15 years as a kitchen manager. Walter helps with opening the restaurant when the owner is absent, He has full knowledge of counting money and can-do food truck orders. During hours of operation maintaining the quality of food and sanitization of the kitchen, working along with the dining room manager to keep customers happy and coming back.\nDining Room Manager- Sunshine Brewster\nSunshine has been an employee with Bert’s for 9 years, She has great charisma and is always a smiling face, handling any issues with customer satisfaction efficiently, Sunshine also has access to the safe for money handling to get change for the cashier, knowledge of opening the front of house, expediting food for other waitresses and daily staff scheduling.\n\nNightshift Leadership\nKitchen Manager-Casey Denham \nCasey Has been with Bert’s for 10 years, He started as a dish washer and quickly worked his way up to manager after 5 years of dedication, Casey has been very efficient with food quality and sanitation, Helps with weekly scheduling and will do inventory along with food truck orders, Casey shares in the responsibility of doing the end of day books with the other night managers, Always checks food cooking equipment at the end of each shift and rallies the kitchen in times of extreme business. Has a proven track record of employee and customer satisfaction.\n\nDining Room manager-Rene Summey\nRene has been with Bert’s for 13 years, she has won awards in Monroe county, TN for best waitress and is a very recognizable face in the community, Rene has access to the bank bags to get change for cashiers, helps with weekly scheduling and front of house hiring and employee evaluations, and ensuring daily customer satisfaction. Rene shares in the responsibility of end of night books and takes bank bags to the bank at the end of all her shifts. \n\nOpening staff key holders- Walter Liszeski, Sunshine Brewster, Rudd Maxwell\nClosing Staff key holders -  Casey Denham, Rene Summey, Rudd Maxwell\nBank Bag responsibilities – Rudd Maxwell, Walter Liszeski, Sunshine Brewster, Rene Summey, Casey Denham\nFood and supply Ordering – Rudd Maxwell, Casey Denham, Walter Liszeski"
    },
    {
      "id": "berts-source-907730c0da0f5a04",
      "title": "BERTS BOH Pizza Station Requirements",
      "filename": "BERTS_BOH_Pizza_Station_Requirements.pdf",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "Pizza / Oven"
      ],
      "roles": [
        "Cook"
      ],
      "documentType": "Closing standard",
      "operationalUse": [
        "Training source",
        "Opening / closing"
      ],
      "assignment": "Cook · Pizza / Oven",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/BERTS_BOH_Pizza_Station_Requirements.pdf",
      "sha256": "907730c0da0f5a04cd67238898efcb98a0e205652bfc2266ce89a89934d76927",
      "textSha256": "83aa9c2fba5b3ad62b7d64bfb038a5d722e9eb4760c1d537229424c647975ae4",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-0b44b5698e3dd208",
        "berts-source-5c4abd3e324c8827",
        "berts-source-33e78221f2adffbf",
        "berts-source-67d68d064444ee1c",
        "berts-source-56e67ec0d8a7d48f"
      ],
      "duplicates": [],
      "conflicts": [
        "pizza-version"
      ],
      "content": "Page 1\nBERTS – BOH – PIZZA STATION REQUIREMENTS\nStandard: Station is fully reset and service-ready.\nPRODUCT\n\n■ Pizza table stocked to par\n\n■ Dough rotated and properly pulled\n\n■ Pans filled for next shift\n\n■ Rolls staged for next day\n\n■ Butter filled, covered, flipped\nSANITATION\n\n■ Pizza table interior clean\n\n■ Gaskets clean\n\n■ Crumb catch tray emptied and cleaned\n\n■ Oven wiped down\n\n■ Walls in oven area clean\n\n■ Speed rack clean with fresh sheet trays\n\n■ No grease under speed rack\n\n■ Wrap bucket shelf clean\n\n■ Trash removed\nORGANIZATION\n\n■ Pans organized\n\n■ Pizza boxes stocked and orderly\n\n■ No loose rags\n\n■ Nothing on floor\nSHUTDOWN\n\n■ Oven off\n\n■ Station fully reset\n"
    },
    {
      "id": "berts-source-5c4abd3e324c8827",
      "title": "Berts Pizza Station Requirements",
      "filename": "Berts_Pizza_Station_Requirements.pdf",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "Pizza / Oven"
      ],
      "roles": [
        "Cook"
      ],
      "documentType": "Closing standard",
      "operationalUse": [
        "Training source",
        "Opening / closing"
      ],
      "assignment": "Cook · Pizza / Oven",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_Pizza_Station_Requirements.pdf",
      "sha256": "5c4abd3e324c882775eb94a131f5df6d7dedea00b536e1f61de9033b22d10850",
      "textSha256": "214f65cb353a4b76cb2ddd810f454e158e71cf54c244d7b54a238b01ca5c7447",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-0b44b5698e3dd208",
        "berts-source-907730c0da0f5a04",
        "berts-source-33e78221f2adffbf",
        "berts-source-67d68d064444ee1c",
        "berts-source-56e67ec0d8a7d48f"
      ],
      "duplicates": [],
      "conflicts": [
        "pizza-version"
      ],
      "content": "Page 1\nBERT'S HOMETOWN GRILL\nPizza Station Requirements\nStation Reset Standards (Applies Before 11AM, Before 4PM, and\nAt Close)\n\nPizza table fully stocked to pars\n\nButter filled, covered, and flipped nightly\n\nRoll pans filled and covered for next day readiness\n\nPizza boxes stocked (station and back window shelving)\n\nSpeed rack sheet trays replaced nightly\n\nGrease cleaned from under speed rack\n\nCrumb catch tray on oven emptied and cleaned\nCleanliness & Organization\n\nPizza table interior wiped and sanitized\n\nDoor gaskets wiped nightly\n\nPizza cutting surface wiped and sanitized\n\nWalls in oven area wiped\n\nGrease bucket shelf cleaned nightly\n\nAll pans under table organized\n\nReach-ins organized and clutter free\nProduct Control\n\nPizza dough pulled from walk-in 30 minutes prior to use\n\nDough evaluated daily for proper usage\n\nBreadsticks prepped in morning for the day\n\nRoll inventory evaluated and restocked as needed\nOperational Flow\n\nDishes carried to dish area throughout shift\n\nNo buildup under speed rack or pizza table\n\nOven exterior wiped nightly\n"
    },
    {
      "id": "berts-source-33e78221f2adffbf",
      "title": "Berts Pizza Oven Station Reset Standard",
      "filename": "Berts_Pizza_Oven_Station_Reset_Standard.pdf",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "Pizza / Oven"
      ],
      "roles": [
        "Cook"
      ],
      "documentType": "Closing standard",
      "operationalUse": [
        "Training source",
        "Opening / closing"
      ],
      "assignment": "Cook · Pizza / Oven",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_Pizza_Oven_Station_Reset_Standard.pdf",
      "sha256": "33e78221f2adffbf4b0c4ce22d365753218e320bc33fdde7d16906c829c6584d",
      "textSha256": "3f8a8dd0faccaa287b7f087f6c027b1582491bc54eab011786078480b8076017",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-0b44b5698e3dd208",
        "berts-source-907730c0da0f5a04",
        "berts-source-5c4abd3e324c8827",
        "berts-source-67d68d064444ee1c",
        "berts-source-56e67ec0d8a7d48f"
      ],
      "duplicates": [],
      "conflicts": [
        "pizza-version"
      ],
      "content": "Page 1\nBERT’S HOMETOWN GRILL\nPIZZA / OVEN STATION\nDaily Reset Standard (Definition of Zero)\n1. Oven & Surrounding Area\n\nOven exterior wiped and free of visible grease\n\nWalls in oven area wiped\n\nNo debris or trash under oven\n\nFloor in pizza/oven zone swept and mopped\n\nWrap bucket washed nightly\n\nWrap shelf fully degreased\n\nNo grease buildup under wrap shelf or speed rack\n2. Pizza Table\n\nInterior emptied and wiped\n\nGaskets wiped\n\nSurface wiped\n\nRail flipped\n\nRail fully stocked to par for next day\n\nAll product labeled correctly\n\nPans under table organized\n3. Dough & Speed Rack\n\nDough for next day properly staged in walk-in\n\nDough must be pulled 30 minutes prior to use during service\n\nSpeed rack sheet trays replaced nightly\n\nGrease and debris under speed rack cleaned nightly\n4. Bread Service\n\nButter filled, covered, flipped\n\nRolls staged and covered for next day\n\nPizza cutting surface sanitized\n\n\nPage 2\n5. Stock & Tools\n\nPizza boxes stocked at station\n\nUtensils replaced and staged\n\nNo rags left out\n\nNo open containers\nFrequency\n\nDaily Reset: Everything listed above\n\nWeekly Deep: Heavy oven grease detail beyond daily wipe\nOwnership\n\nPizza closer owns the entire physical bubble\n\nNothing in this bubble floats\n"
    },
    {
      "id": "berts-source-67d68d064444ee1c",
      "title": "Berts Pizza Oven Station Reset Standard v2",
      "filename": "Berts_Pizza_Oven_Station_Reset_Standard_v2.pdf",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "Pizza / Oven"
      ],
      "roles": [
        "Cook"
      ],
      "documentType": "Closing standard",
      "operationalUse": [
        "Training source",
        "Opening / closing"
      ],
      "assignment": "Cook · Pizza / Oven",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_Pizza_Oven_Station_Reset_Standard_v2.pdf",
      "sha256": "67d68d064444ee1c7d0523c99cb07741703c12d879a8a69a1b315f66e5d6adb4",
      "textSha256": "4d6f69420dc93af0b966572bf4619e1388374899182f0fbc5e31bb4e89f8c9fe",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-0b44b5698e3dd208",
        "berts-source-907730c0da0f5a04",
        "berts-source-5c4abd3e324c8827",
        "berts-source-33e78221f2adffbf",
        "berts-source-56e67ec0d8a7d48f"
      ],
      "duplicates": [],
      "conflicts": [
        "pizza-version"
      ],
      "content": "Page 1\nBERT'S HOMETOWN GRILL\nPIZZA / OVEN STATION\nCLOSE REQUIREMENTS\n1. Oven & Surrounding Area\n\nOven exterior wiped and free of visible grease\n\nWalls in oven area wiped\n\nNo debris or trash under oven\n\nFloor in pizza/oven zone swept and mopped\n\nCrumb catch tray emptied and cleaned nightly\n\nWrap bucket washed nightly\n\nWrap shelf fully degreased\n\nNo grease buildup under wrap shelf or speed rack\n2. Pizza Table\n\nInterior emptied and wiped\n\nGaskets wiped\n\nSurface wiped\n\nRail flipped\n\nRail fully stocked to par for next day\n\nAll product labeled correctly\n\nPans under table organized\n3. Dough & Speed Rack\n\nDough for next day properly staged in walk-in\n\nDough must be pulled 30 minutes prior to use during service\n\nSpeed rack sheet trays replaced nightly\n\nGrease and debris under speed rack cleaned nightly\n4. Bread Service\n\nButter filled, covered, flipped\n\nRolls staged and covered for next day\n\nPizza cutting surface sanitized\n\n\nPage 2\n5. Stock & Tools\n\nPizza boxes stocked at station\n\nUtensils replaced and staged\n\nNo rags left out\n\nNo open containers\nFrequency\n\nDaily Reset: Everything listed above\n\nWeekly Deep: Heavy oven grease detail beyond daily wipe\nOwnership\n\nPizza closer owns the entire physical bubble\n\nNothing in this bubble floats\n"
    },
    {
      "id": "berts-source-01700b1c62e61e46",
      "title": "Berts Opening Checklist",
      "filename": "Berts_Opening_Checklist.docx",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "FOH",
      "stations": [
        "Server Station",
        "Dining Room",
        "Back Window"
      ],
      "roles": [
        "Server",
        "FOH Manager"
      ],
      "documentType": "Opening standard",
      "operationalUse": [
        "Opening / closing",
        "Safety / cleaning"
      ],
      "assignment": "FOH opening / closing; exact station owner needs review",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_Opening_Checklist.docx",
      "sha256": "01700b1c62e61e46835559e383ac57d015f72e6eb0f866bf90ed3c817ac34900",
      "textSha256": "a4b6f28cec02fc369ed49a9dba7196b6e0b003d262e9029ec3202be607934360",
      "capturedAt": "2026-09-10",
      "relatedVersions": [],
      "duplicates": [],
      "conflicts": [],
      "content": "Opening Checklist\nMake tea - 10 cups sugar, home brew\nUse the first round of tea to fill half gallons for fridge, label & date\nMake unsweet tea\nStock dressing cups for both coolers\nCheck dessert case, pull cakes as needed\nStock to-go cups, lids, straws, boxes, pizza boxes, lids, kids cups, ramekin lids, etc.\nMake ranch if needed - after cups are made\nStock 2-liters\nLay out rugs\nTurn on radio, TVs, and menus\nFill ice\nSet up soda nozzles\nPut chairs down\nFill love shakers\nTurn on clock"
    },
    {
      "id": "berts-source-0591b88a39d18631",
      "title": "Berts Closing Checklist",
      "filename": "Berts_Closing_Checklist.docx",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "FOH",
      "stations": [
        "Server Station",
        "Dining Room",
        "Back Window"
      ],
      "roles": [
        "Server",
        "FOH Manager"
      ],
      "documentType": "Closing standard",
      "operationalUse": [
        "Opening / closing",
        "Safety / cleaning"
      ],
      "assignment": "FOH opening / closing; exact station owner needs review",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_Closing_Checklist.docx",
      "sha256": "0591b88a39d18631cdb4c42ccf691a458c068c115aa1f38bdb01c195c9826a1c",
      "textSha256": "35667ef32eabfa8e7a8f1237de8992e0aa50256df9c47ce74cbc243ac856ec1b",
      "capturedAt": "2026-09-10",
      "relatedVersions": [],
      "duplicates": [],
      "conflicts": [
        "missing-methods"
      ],
      "content": "Closing Checklist\nEmpty tea urns & wash them. Bring the backup when done.\nVacuum rugs & pull them.\nClean front doors, inside & out.\nPull coke tabs & soak in soda water.\nPut chairs up.\nDouble check tables: wipe, stock & fill menus.\nClean bathrooms: mirrors, stock toilet paper, check soap, sinks, counter, toilet, sweep, & mop.\nWrap silverware.\nStock runner table.\nPut parms up.\nTurn off TVs, menus, & radio.\nTurn off clock."
    },
    {
      "id": "berts-source-59d7c543de85b96b",
      "title": "Berts Host Job Description Updated",
      "filename": "Berts_Host_Job_Description_Updated.docx",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "FOH",
      "stations": [
        "Host",
        "Salad Bar",
        "Back Window"
      ],
      "roles": [
        "Host"
      ],
      "documentType": "Role training",
      "operationalUse": [
        "Training source"
      ],
      "assignment": "Historical combined Host duties; current station split needs review",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_Host_Job_Description_Updated.docx",
      "sha256": "59d7c543de85b96b3e475cabe7a5d6d10fb9b0209b161a246196ed04ac8fd462",
      "textSha256": "c38fa550c99290b33db5fcf56f1052f12e9be9bc3cd5dc4a11dc5bf4f99f395a",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-2a833dcd11eb4257"
      ],
      "duplicates": [],
      "conflicts": [
        "host-scope"
      ],
      "content": "HOST – Job Description\nLocation: Bert’s Hometown Grill\nReports To: Front of House Manager / Shift Lead\nPosition Type: Part-time or Full-time | Weekends Required\nOverview:\nHosts at Bert’s are the first and last impression guests receive, responsible for creating a welcoming environment and maintaining a smooth seating flow. In addition to seating guests, hosts may also maintain the salad bar, bus tables, and support the overall cleanliness and organization of the front of house. This role adapts based on time of day and staffing levels.\nDay Shift Responsibilities (Typically 1–2 Hosts):\n- Greet and seat guests promptly and with a smile\n- Maintain an accurate waitlist and table rotation\n- Keep salad bar stocked, clean, and guest-ready\n- Clean menus, tables, windows, and high-touch areas\n- Help bus and reset tables during lulls in seating\n- Communicate with servers about large parties or table needs\n- Answer phones and take to-go orders if needed\nNight Shift Responsibilities (Team of 2–3 Hosts):\nSeating Host:\n- Manage seating flow, waitlist, and table rotation\n- Greet guests at the door and assign tables evenly\n- Communicate with servers and shift lead on seating pacing\nSalad Bar Attendant:\n- Maintain fresh, clean, and full salad bar throughout shift\n- Restock lettuce, toppings, dressings, croutons, bowls, etc.\n- Sanitize bar area frequently and monitor for spills or mess\nSupport Host:\n- Assist in bussing and resetting tables\n- Support salad bar attendant and seating host as needed\n- Monitor restrooms, floors, and high-traffic areas for cleanliness\n- Restock cups, silverware, napkins, etc.\nOpening Duties Checklist:\n- [ ] Turn on host stand equipment and check guest seating chart\n- [ ] Wipe down and sanitize menus\n- [ ] Organize host stand (pens, waitlist sheet/tablet, to-go menus)\n- [ ] Make sure entryway and front door area are clean and welcoming\n- [ ] Check that tables are clean, dry, and properly set with silverware and napkins\n- [ ] Check and clean high chairs/booster seats\n- [ ] Salad bar:\n- [ ]    - Ice down the salad bar\n- [ ]    - Restock lettuce, toppings, dressings, and bowls\n- [ ]    - Ensure sneeze guard and counter are clean and sanitized\n- [ ] Confirm tea is being made (communicate with server if not your responsibility)\n- [ ] Coordinate with shift lead on any large parties, call-ahead seating, or reservations\n- [ ] Check restrooms for cleanliness and supplies (if not a server/FOH task)\nClosing Duties Checklist:\n- [ ] Wipe down and sanitize host stand and all menus\n- [ ] Empty trash at host stand\n- [ ] Break down salad bar and store leftovers properly\n- [ ] Clean and sanitize salad bar thoroughly\n- [ ] Check bathrooms and restock toilet paper, soap, paper towels\n- [ ] Sweep entry area and front of house if needed\n- [ ] Assist with final table resets and dining room walkthrough\n- [ ] Ensure salad bar and front stations are ready for next day\n- [ ] Get checkout from shift lead or manager before clocking out\nPhysical Requirements:\n- Must be able to stand/walk for long periods (6+ hours)\n- Light lifting (up to 25 lbs) for restocking or salad bar supplies\n- Must be able to work around food, cleaning supplies, and customers\nExpectations:\n- Maintain a positive, welcoming attitude at all times\n- Be organized and communicate clearly with team and guests\n- Stay aware of dining room needs and guest flow\n- Support the team by staying busy and available between guests\n- Follow all sanitation and safety standards\nGo-Home Duties (For Hosts Leaving Before Close):\n- [ ] Top off all salad bar items before leaving\n- [ ] Restock salad bar bowls, plates, and utensils\n- [ ] Check and restock to-go menus, cups, and silverware at host stand\n- [ ] Wipe down salad bar and host stand areas you used\n- [ ] Communicate with closing host about any needs or issues before leaving"
    },
    {
      "id": "berts-source-2a833dcd11eb4257",
      "title": "Host Training Checklist Berts",
      "filename": "Host_Training_Checklist_Berts.docx",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "FOH",
      "stations": [
        "Host",
        "Salad Bar",
        "Back Window"
      ],
      "roles": [
        "Host"
      ],
      "documentType": "Role training",
      "operationalUse": [
        "Training source"
      ],
      "assignment": "Historical combined Host duties; current station split needs review",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Host_Training_Checklist_Berts.docx",
      "sha256": "2a833dcd11eb42572e36cd92f6391ba7d2b7ed76c6c8d96774c5d8c39a72cdc3",
      "textSha256": "8e80824d80dd16e1e5bdbc91a3d6aeb6f664620bf537d7b70e0acfbcb34f842e",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-59d7c543de85b96b"
      ],
      "duplicates": [],
      "conflicts": [
        "host-scope"
      ],
      "content": "Host Training Checklist Guide — Bert’s Hometown Grill & Pizzeria\nDay 1–2: Orientation & Basics\n☐ Tour of the restaurant (dining room, bathrooms, salad bar, expo, server stations).\n☐ Review of host responsibilities: Greeting guests warmly, quoting wait times accurately, seating guests fairly and evenly among servers, maintaining a positive and professional attitude.\n☐ Review dress code & appearance standards.\n☐ Learn employee parking policy (lower lot).\n☐ Learn how to clock in/out on POS.\nGreeting & Seating\n☐ Learn to greet guests promptly at the door.\n☐ Practice smiling, eye contact, and friendly tone.\n☐ Learn to quote accurate wait times.\n☐ Understand seating rotation and server sections.\n☐ Properly seat guests with menus, silverware, and kid’s menus if needed.\n☐ Communicate special seating needs (wheelchair, highchairs, large parties).\nPhone & To-Go Orders\n☐ Learn to answer the phone professionally.\n☐ Take messages for management when needed.\n☐ Learn to handle to-go orders (write down, enter in POS if applicable, give to expo or server).\nSalad Bar Duties\n☐ Daily setup of salad bar (dressings, toppings, utensils).\n☐ Maintain cleanliness and restocking during shifts.\n☐ End-of-shift breakdown and cleaning procedures.\nBussing & Cleaning\n☐ Learn to buss tables quickly & efficiently.\n☐ Wipe down tables, chairs, and condiment bottles.\n☐ Reset tables with silverware and menus as needed.\n☐ Keep entryway and host stand tidy.\n☐ Restock silverware and napkins as needed.\nExpo & Support Duties\n☐ Help expo with butter, sour cream, coleslaw, dressings as needed.\n☐ Run food when asked by servers or expo.\n☐ Assist with sidework (folding pizza boxes, filling sauces, etc.).\nSpecial Duties\n☐ Know Tuesday morning reset (sugar caddies, salt & pepper shakers).\n☐ Assist with stocking when truck comes in (Mon, Thu, Fri).\n☐ Help wipe menus and sanitize high-touch areas regularly.\nEnd-of-Shift Duties\n☐ Clean and restock host stand.\n☐ Check bathrooms.\n☐ Help close down salad bar if closing shift.\n☐ Communicate with manager before leaving.\nSkills Sign-Off (Trainer Initials)\n☐ Greeting & Seating …\n☐ Phone Etiquette …\n☐ Salad Bar Duties …\n☐ Bussing/Cleaning …\n☐ Expo Support …\n☐ End-of-Shift …"
    },
    {
      "id": "berts-source-56e67ec0d8a7d48f",
      "title": "Berts Oven Cook Job Description",
      "filename": "Berts_Oven_Cook_Job_Description.pdf",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "Pizza / Oven"
      ],
      "roles": [
        "Cook"
      ],
      "documentType": "Role training",
      "operationalUse": [
        "Training source",
        "Opening / closing"
      ],
      "assignment": "Cook · Pizza / Oven",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_Oven_Cook_Job_Description.pdf",
      "sha256": "56e67ec0d8a7d48f4db1779b8a1cd4d3111c91bff01cc8c114274eba3717dc33",
      "textSha256": "2f88dfb62b1f9782478cf7b463f3c5f5bb30f8fb4b48639a740c707f9d429291",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-0b44b5698e3dd208",
        "berts-source-907730c0da0f5a04",
        "berts-source-5c4abd3e324c8827",
        "berts-source-33e78221f2adffbf",
        "berts-source-67d68d064444ee1c"
      ],
      "duplicates": [],
      "conflicts": [],
      "content": "Page 1\nOVEN COOK (PIZZA)\nBert’s Hometown Grill\nReports To: BOH Manager\nPosition Summary\nThe Oven Cook is responsible for preparing pizzas and oven-based menu items according to Bert’s\nstandards while maintaining product quality, proper prep levels, food safety practices, and kitchen ticket\nflow.\nPrimary Responsibilities\n Prepare pizzas according to Bert’s recipes, builds, and portion standards\n Pull panned pizza dough from the walk-in at least 30 minutes before use to allow dough to temper\nproperly\n Top pizzas accurately using the designated ladle for sauce and portion cups for cheese\n Ensure pizzas are built consistently and correctly every time\n Cut and box pizzas for takeout orders\n Place dine-in pizzas in pans in the service window\n Stock pizza station before service and restock during and after shift\n Ensure all prepped items are properly labeled, dated, and rotated\n Monitor oven cook times and product quality\n Maintain oven station cleanliness and organization throughout the shift\n Communicate with expo and other kitchen stations during service\n Assist with pizza prep when needed\n Complete opening and closing responsibilities for the oven station\nPerformance Expectations\n Consistent pizza quality, appearance, and doneness\n Proper sauce and cheese portioning on every pizza\n Station stocked and ready before service begins\n Panned dough properly tempered before use\n Proper labeling, dating, and food rotation at all times\n Clean workstation throughout the shift\n Strong communication during busy periods\n Ability to manage multiple tickets without losing accuracy\n Sense of urgency during peak service\n"
    },
    {
      "id": "berts-source-ea78f6753e8ec648",
      "title": "Berts Kitchen Manager Agenda",
      "filename": "Berts_Kitchen_Manager_Agenda.docx",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "BOH leadership"
      ],
      "roles": [
        "Kitchen Manager"
      ],
      "documentType": "Manager workflow",
      "operationalUse": [
        "Reference only"
      ],
      "assignment": "Kitchen Manager preparation, service and handoff",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "draft",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_Kitchen_Manager_Agenda.docx",
      "sha256": "ea78f6753e8ec6487c36838415c26a767ca352496955cc53e9571a19b0ad93d1",
      "textSha256": "ab62f521393d06708a7852227d501f1afb95aa35fa01481c04dadfb30ef33a2c",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-f8ce9d11586f8029",
        "berts-source-c048ed3b29c84fc9"
      ],
      "duplicates": [],
      "conflicts": [],
      "content": "Kitchen Manager Meeting Agenda – Bert’s\nCleaning & Organization\nWe need to raise our standards of cleanliness and keep every area consistently organized. This includes setting clear expectations and routines for each shift.\nTask\nAssigned To\nMaintain walk-in shed – Keep the walk-in clean and organized daily; no clutter or expired product.\n\nOrganization behind no dish/left – Clean and structure the area behind the dish station and left side of the line.\n\nDetail equipment cleaning – Assign responsibility for cleaning fryers, ovens, toasters, etc., on a rotating basis.\n\nSection cleaning – Rotate deep-cleaning specific kitchen sections each week (grill, pizza, salad, etc.).\n\nOutside cleaning – Don’t neglect exterior cleaning (e.g., dumpster area, sidewalks, back door).\n\nWeekly cleaning matrix – Set a visual, trackable weekly schedule for deep cleans.\n\nCleaning list – Have a posted checklist for each area to be followed daily.\n\nCleaning station list – Assign who is responsible for what station at the start of every shift.\n\nHealth code list – Review current health standards and create a list of must-hit points to avoid violations.\n\nPrep & Efficiency\nOur prep work should set up every shift for success. Prioritize smart prep flow and staying ahead on high-use items.\nTask\nAssigned To\nTemp steaks smaller – Adjust steak sizes for better portion control and quicker cook times.\n\nMaking dough first thing – Ensure dough prep starts immediately to avoid falling behind.\n\nPanning all pizza pans – Prep and pan pizzas early to be ready for dinner rush.\n\nEquipment & Inventory\nStay on top of broken or malfunctioning equipment, and ensure inventory processes are accurate and efficient.\nTask\nAssigned To\nBehind broc – Clean and organize behind the broccoli station or clarify if this refers to another piece of equipment.\n\nGrocery list format – Standardize how lists are written so managers can easily order or pull inventory.\n\nEquipment issues list – Keep a running list of needed repairs or service requests.\n\nTraining & Staffing\nWe need everyone to step up, learn more than one station, and stay flexible. This will strengthen the whole team.\nTask\nAssigned To\nCross-train all stations – All cooks should be capable of running more than one area.\n\nGetting out of our comfort zone – Encourage leads to try new responsibilities and lead by example.\n\nAccountability & Communication\nEstablish clear communication systems so the team knows what’s needed, what’s falling short, and how to fix it.\nTask\nAssigned To\nCreate a prep list – Every shift needs a written prep list to prevent confusion or missed items.\n\nCreate a push list – Have a real-time list during service for what needs to be prepped/refilled ASAP.\n\nCreate an issues list – Note recurring problems (staffing, product, process) and review weekly.\n\nReview chat format – Set expectations for group chats (shift recaps, respectful tone, clear info).\n"
    },
    {
      "id": "berts-source-e45b7c3babe5a7e7",
      "title": "Berts AM Prep List with Pull Thaw",
      "filename": "Berts_AM_Prep_List_with_Pull_Thaw.xlsx",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "Pizza / Oven",
        "Fry",
        "Grill",
        "Sandwich",
        "Salad Bar"
      ],
      "roles": [
        "Cook",
        "Kitchen Manager"
      ],
      "documentType": "Prep / par",
      "operationalUse": [
        "Prep / par"
      ],
      "assignment": "Station-owned preparation; station-to-product assignment needs review",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_AM_Prep_List_with_Pull_Thaw.xlsx",
      "sha256": "e45b7c3babe5a7e78e3de818fe2fdf672e6b72dc87280d110e44b7b50da0d13b",
      "textSha256": "2a24d0a53047dcff6960fc89c31899336fcfd1184bb8d13319851127f26bfbef",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-ca142b1727a5da72",
        "berts-source-5ab97d9aca37835a",
        "berts-source-6fbcb115dd24baad",
        "berts-source-48162cfeb9000201"
      ],
      "duplicates": [],
      "conflicts": [
        "prep-values"
      ],
      "content": "Sheet: AM Prep List\nA1=Product | B1=Unit | C1=Shelf Life | D1=Prep Today? (Y/N) | E1=Amount to Prep | F1=Last Made (Date)\nA2=Pot Skins Prep | B2=4\" Hotel Pan | C2=2 Days\nA3=Pot Wedge | B3=4\" Hotel Pan | C3=2 Days\nA4=Fish Batter/Flour | B4=1/3 Pan each | C4=1 Day\nA5=Grill Mushrooms | B5=1/3 Pan each | C5=3 Days\nA6=Rolls | B6=2 Pans / 1 Case | C6=1 Day\nA7=Bread Stix | B7=2 Pans | C7=1 Day\nA8=Ribeye | B8=3 1/2 Pans | C8=3 Days\nA9=Sirloin | B9=3 1/2 Pans | C9=3 Days\nA10=Pork Chops | C10=3 Days\nA11=Cod | C11=4 Days\nA12=Tips | B12=3 1/3 Pans | C12=3 Days\nA13=Pan Chicken | B13=4\" Full Pans | C13=3 Days\nA14=Salmon | B14=6 | C14=4 Days\nA15=Pan Burgers | B15=1 Full Pan | C15=4 Days\nA16=Spaghetti Sauce | B16=1/2 Pan | C16=3 Days\nA17=Corn Dogs | C17=1-2 Days (thaw)\nA18=Egg Rolls | C18=1-2 Days (thaw)\nA19=Cod | C19=4 Days (thawed)"
    },
    {
      "id": "berts-source-ca142b1727a5da72",
      "title": "Berts AM Prep List with Bulk Thaw",
      "filename": "Berts_AM_Prep_List_with_Bulk_Thaw.xlsx",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "Pizza / Oven",
        "Fry",
        "Grill",
        "Sandwich",
        "Salad Bar"
      ],
      "roles": [
        "Cook",
        "Kitchen Manager"
      ],
      "documentType": "Prep / par",
      "operationalUse": [
        "Prep / par"
      ],
      "assignment": "Station-owned preparation; station-to-product assignment needs review",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_AM_Prep_List_with_Bulk_Thaw.xlsx",
      "sha256": "ca142b1727a5da72c7f4a666a66d35c9c2b806ab2ab0bd0e2cd97379756844ca",
      "textSha256": "bbaef41fbffec3430a0d6bf7c8368914dc0e809d1271a21aa9ff91d20ae9fb40",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-e45b7c3babe5a7e7",
        "berts-source-5ab97d9aca37835a",
        "berts-source-6fbcb115dd24baad",
        "berts-source-48162cfeb9000201"
      ],
      "duplicates": [],
      "conflicts": [
        "prep-values"
      ],
      "content": "Sheet: AM Prep List\nA1=Product | B1=Unit | C1=Shelf Life | D1=Prep Today? (Y/N) | E1=Amount to Prep | F1=Last Made (Date)\nA2=Pot Skins Prep | B2=4\" Hotel Pan | C2=2 Days\nA3=Pot Wedge | B3=4\" Hotel Pan | C3=2 Days\nA4=Fish Batter/Flour | B4=1/3 Pan each | C4=1 Day\nA5=Grill Mushrooms | B5=1/3 Pan each | C5=3 Days\nA6=Rolls | B6=2 Pans / 1 Case | C6=1 Day\nA7=Bread Stix | B7=2 Pans | C7=1 Day\nA8=Ribeye | B8=3 1/2 Pans | C8=3 Days\nA9=Sirloin | B9=3 1/2 Pans | C9=3 Days\nA10=Pork Chops | C10=3 Days\nA11=Cod | C11=4 Days\nA12=Tips | B12=3 1/3 Pans | C12=3 Days\nA13=Pan Chicken | B13=4\" Full Pans | C13=3 Days\nA14=Salmon | B14=6 | C14=4 Days\nA15=Pan Burgers | B15=1 Full Pan | C15=4 Days\nA16=Spaghetti Sauce | B16=1/2 Pan | C16=3 Days\nA17=Corn Dogs | C17=1-2 Days (thaw)\nA18=Egg Rolls | C18=1-2 Days (thaw)\nA19=Cod | C19=4 Days (thawed)\nA20=Spaghetti Sauce (Bulk) | B20=Full Batch | C20=3 Days\nA21=Brown Gravy (Bulk) | B21=Full Batch | C21=3 Days\nA22=Mashed Potatoes | B22=Full Batch | C22=2 Days\nA23=Alfredo Sauce (Bulk) | B23=Full Batch | C23=2 Days\nA24=BBQ Sauce (Portioned) | B24=Bucket | C24=3 Days\nA25=Pizza Sauce | B25=1/2 Pan | C25=3 Days\nA26=Pasta | B26=1 Bucket | C26=3 Days\nA27=Cooked Bacon | B27=1 Case | C27=3 Days\nA28=Broccoli | B28=1 Case | C28=3 Days"
    },
    {
      "id": "berts-source-5ab97d9aca37835a",
      "title": "Berts Daily Opening and Prep List",
      "filename": "Berts_Daily_Opening_and_Prep_List.xlsx",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "Pizza / Oven",
        "Fry",
        "Grill",
        "Sandwich",
        "Salad Bar"
      ],
      "roles": [
        "Cook",
        "Kitchen Manager"
      ],
      "documentType": "Prep / par",
      "operationalUse": [
        "Prep / par"
      ],
      "assignment": "Station-owned preparation; station-to-product assignment needs review",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_Daily_Opening_and_Prep_List.xlsx",
      "sha256": "5ab97d9aca37835ab6879ed031e83c042b296d965879aecf46caabba321af634",
      "textSha256": "0336812fc666e1c5527825ef1f4595b32b56ca36186613a3cca763acd23f34c2",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-e45b7c3babe5a7e7",
        "berts-source-ca142b1727a5da72",
        "berts-source-6fbcb115dd24baad",
        "berts-source-48162cfeb9000201"
      ],
      "duplicates": [],
      "conflicts": [
        "prep-values"
      ],
      "content": "Sheet: Opening Checklist\nA1=Opening Tasks\nA2=Turn on all cooking equipment (ovens, flat top, steam wells, fryer)\nA3=Start baking potatoes (___ trays)\nA4=Heat mashed potatoes\nA5=Heat brown gravy\nA6=Heat spaghetti sauce\nA7=Heat alfredo sauce (if scheduled)\nA8=Heat BBQ\nA9=Make fresh salad mix\nA10=Check tomato, cucumber, red onion (prep if needed)\nA11=Grill onions (1/3 pan fresh daily)\nA12=Restock salad bar & undercoolers\nA13=Cook bacon (if scheduled)\nA14=Cook pasta (if scheduled)\nA15=Steam/roast broccoli (if scheduled)\nA16=Portion sauces, label, and rotate\nA17=Clean prep area, refill sanitizer buckets\nSheet: Daily Prep List\nA1=Product | B1=Unit | C1=Shelf Life | D1=Prep Days\nA2=Salad mix | B2=6\" hotel pan | C2=1 day | D2=Daily\nA3=Tomato slices | B3=1/3 pan | C3=2 days | D3=Mon, Wed, Fri, Sun\nA4=Julienne red onion | B4=1/3 pan | C4=2 days | D4=Mon, Wed, Fri, Sun\nA5=Cucumber slices | B5=1/6 pan | C5=2 days | D5=Mon, Wed, Fri, Sun\nA6=Green pepper sliced | B6=1/3 pan | C6=3 days | D6=Sun, Wed, Sat\nA7=Grilled onions | B7=1/3 pan | C7=1 day | D7=Daily\nA8=Slaw | B8=1 bag | C8=3 days | D8=Mon, Thurs\nA9=Pasta | B9=1 bucket | C9=3 days | D9=Sun, Wed, Fri\nA10=Bacon (cooked) | B10=1 case | C10=3 days | D10=Sun, Wed, Fri\nA11=Broccoli | B11=1 case | C11=3 days | D11=Sun, Wed, Fri\nA12=Pizza sauce | B12=1/2 pan | C12=3 days | D12=Mon, Thurs\nA13=Portion BBQ | B13=1 bucket | C13=3 days | D13=Mon, Thurs\nA14=Spaghetti sauce | B14=1/2 pan | C14=3 days | D14=Mon, Thurs\nA15=Heat spag/alfredo | B15=1 full pan | C15=2 days | D15=Mon, Wed, Fri\nA16=Heat gravy | B16=1/2 pan | C16=3 days | D16=Mon, Thurs"
    },
    {
      "id": "berts-source-6fbcb115dd24baad",
      "title": "Berts Daily Opening and Prep List Fillable",
      "filename": "Berts_Daily_Opening_and_Prep_List_Fillable.xlsx",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "Pizza / Oven",
        "Fry",
        "Grill",
        "Sandwich",
        "Salad Bar"
      ],
      "roles": [
        "Cook",
        "Kitchen Manager"
      ],
      "documentType": "Prep / par",
      "operationalUse": [
        "Prep / par"
      ],
      "assignment": "Station-owned preparation; station-to-product assignment needs review",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_Daily_Opening_and_Prep_List_Fillable.xlsx",
      "sha256": "6fbcb115dd24baadf6f0f8346dd38048a8d062d39b0c599a2c06f47ca702ee4a",
      "textSha256": "70ad3c8a595b0502a3b0f36f0df07c3e6c58638036b0417551fcdcd78032c1db",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-e45b7c3babe5a7e7",
        "berts-source-ca142b1727a5da72",
        "berts-source-5ab97d9aca37835a",
        "berts-source-48162cfeb9000201"
      ],
      "duplicates": [
        {
          "id": "berts-source-48162cfeb9000201",
          "kind": "same extracted cells or text"
        }
      ],
      "conflicts": [
        "prep-values"
      ],
      "content": "Sheet: Opening Checklist\nA1=Opening Tasks\nA2=Turn on all cooking equipment (ovens, flat top, steam wells, fryer)\nA3=Start baking potatoes (___ trays)\nA4=Heat mashed potatoes\nA5=Heat brown gravy\nA6=Heat spaghetti sauce\nA7=Heat alfredo sauce (if scheduled)\nA8=Heat BBQ\nA9=Make fresh salad mix\nA10=Check tomato, cucumber, red onion (prep if needed)\nA11=Grill onions (1/3 pan fresh daily)\nA12=Restock salad bar & undercoolers\nA13=Cook bacon (if scheduled)\nA14=Cook pasta (if scheduled)\nA15=Steam/roast broccoli (if scheduled)\nA16=Portion sauces, label, and rotate\nA17=Clean prep area, refill sanitizer buckets\nSheet: Daily Prep List\nA1=Product | B1=Unit | C1=Shelf Life | D1=Prep Days | E1=Prep Today? (Y/N) | F1=Amount to Prep | G1=Last Made (Date)\nA2=Salad mix | B2=6\" hotel pan | C2=1 day | D2=Daily\nA3=Tomato slices | B3=1/3 pan | C3=2 days | D3=Mon, Wed, Fri, Sun\nA4=Julienne red onion | B4=1/3 pan | C4=2 days | D4=Mon, Wed, Fri, Sun\nA5=Cucumber slices | B5=1/6 pan | C5=2 days | D5=Mon, Wed, Fri, Sun\nA6=Green pepper sliced | B6=1/3 pan | C6=3 days | D6=Sun, Wed, Sat\nA7=Grilled onions | B7=1/3 pan | C7=1 day | D7=Daily\nA8=Slaw | B8=1 bag | C8=3 days | D8=Mon, Thurs\nA9=Pasta | B9=1 bucket | C9=3 days | D9=Sun, Wed, Fri\nA10=Bacon (cooked) | B10=1 case | C10=3 days | D10=Sun, Wed, Fri\nA11=Broccoli | B11=1 case | C11=3 days | D11=Sun, Wed, Fri\nA12=Pizza sauce | B12=1/2 pan | C12=3 days | D12=Mon, Thurs\nA13=Portion BBQ | B13=1 bucket | C13=3 days | D13=Mon, Thurs\nA14=Spaghetti sauce | B14=1/2 pan | C14=3 days | D14=Mon, Thurs\nA15=Heat spag/alfredo | B15=1 full pan | C15=2 days | D15=Mon, Wed, Fri\nA16=Heat gravy | B16=1/2 pan | C16=3 days | D16=Mon, Thurs"
    },
    {
      "id": "berts-source-48162cfeb9000201",
      "title": "Berts Daily Opening and Prep List Fillable Simple",
      "filename": "Berts_Daily_Opening_and_Prep_List_Fillable_Simple.xlsx",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "BOH",
      "stations": [
        "Pizza / Oven",
        "Fry",
        "Grill",
        "Sandwich",
        "Salad Bar"
      ],
      "roles": [
        "Cook",
        "Kitchen Manager"
      ],
      "documentType": "Prep / par",
      "operationalUse": [
        "Prep / par"
      ],
      "assignment": "Station-owned preparation; station-to-product assignment needs review",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "unverified",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_Daily_Opening_and_Prep_List_Fillable_Simple.xlsx",
      "sha256": "48162cfeb900020110604c78c8388e962bc8dba3d1029b9c7fd8964d412a399c",
      "textSha256": "70ad3c8a595b0502a3b0f36f0df07c3e6c58638036b0417551fcdcd78032c1db",
      "capturedAt": "2026-09-10",
      "relatedVersions": [
        "berts-source-e45b7c3babe5a7e7",
        "berts-source-ca142b1727a5da72",
        "berts-source-5ab97d9aca37835a",
        "berts-source-6fbcb115dd24baad"
      ],
      "duplicates": [
        {
          "id": "berts-source-6fbcb115dd24baad",
          "kind": "same extracted cells or text"
        }
      ],
      "conflicts": [
        "prep-values"
      ],
      "content": "Sheet: Opening Checklist\nA1=Opening Tasks\nA2=Turn on all cooking equipment (ovens, flat top, steam wells, fryer)\nA3=Start baking potatoes (___ trays)\nA4=Heat mashed potatoes\nA5=Heat brown gravy\nA6=Heat spaghetti sauce\nA7=Heat alfredo sauce (if scheduled)\nA8=Heat BBQ\nA9=Make fresh salad mix\nA10=Check tomato, cucumber, red onion (prep if needed)\nA11=Grill onions (1/3 pan fresh daily)\nA12=Restock salad bar & undercoolers\nA13=Cook bacon (if scheduled)\nA14=Cook pasta (if scheduled)\nA15=Steam/roast broccoli (if scheduled)\nA16=Portion sauces, label, and rotate\nA17=Clean prep area, refill sanitizer buckets\nSheet: Daily Prep List\nA1=Product | B1=Unit | C1=Shelf Life | D1=Prep Days | E1=Prep Today? (Y/N) | F1=Amount to Prep | G1=Last Made (Date)\nA2=Salad mix | B2=6\" hotel pan | C2=1 day | D2=Daily\nA3=Tomato slices | B3=1/3 pan | C3=2 days | D3=Mon, Wed, Fri, Sun\nA4=Julienne red onion | B4=1/3 pan | C4=2 days | D4=Mon, Wed, Fri, Sun\nA5=Cucumber slices | B5=1/6 pan | C5=2 days | D5=Mon, Wed, Fri, Sun\nA6=Green pepper sliced | B6=1/3 pan | C6=3 days | D6=Sun, Wed, Sat\nA7=Grilled onions | B7=1/3 pan | C7=1 day | D7=Daily\nA8=Slaw | B8=1 bag | C8=3 days | D8=Mon, Thurs\nA9=Pasta | B9=1 bucket | C9=3 days | D9=Sun, Wed, Fri\nA10=Bacon (cooked) | B10=1 case | C10=3 days | D10=Sun, Wed, Fri\nA11=Broccoli | B11=1 case | C11=3 days | D11=Sun, Wed, Fri\nA12=Pizza sauce | B12=1/2 pan | C12=3 days | D12=Mon, Thurs\nA13=Portion BBQ | B13=1 bucket | C13=3 days | D13=Mon, Thurs\nA14=Spaghetti sauce | B14=1/2 pan | C14=3 days | D14=Mon, Thurs\nA15=Heat spag/alfredo | B15=1 full pan | C15=2 days | D15=Mon, Wed, Fri\nA16=Heat gravy | B16=1/2 pan | C16=3 days | D16=Mon, Thurs"
    },
    {
      "id": "berts-source-d64f8a5396980a7d",
      "title": "Berts Recovered Station Roles and Checklist Material",
      "filename": "Berts_Recovered_Station_Roles_and_Checklist_Material.pdf",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "Management",
      "stations": [
        "Restaurant leadership"
      ],
      "roles": [
        "Owner",
        "General Manager"
      ],
      "documentType": "Operating reference",
      "operationalUse": [
        "Reference only"
      ],
      "assignment": "Owner review and source reconciliation",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "draft",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_Recovered_Station_Roles_and_Checklist_Material.pdf",
      "sha256": "d64f8a5396980a7d95a3634a91539939d136427ed6a086fd409576bc73b72934",
      "textSha256": "d48d72683fe2c08a4510788d9309e8d3da3ab046705c793c9c980ee0968d484d",
      "capturedAt": "2026-09-10",
      "relatedVersions": [],
      "duplicates": [],
      "conflicts": [],
      "content": "Page 1\nBert's recovered station and role material\nPage 1\nBert's Recovered Station Roles and\nChecklist Material\nUpload-ready evidence summary for Manus | Prepared August 22, 2026\nThis document gathers what could be recovered from prior Rudd and Jay conversations,\ncurrent JMAX decisions, and stored Bert's operating documents. It is not a finished SOP\nmanual. It separates current confirmed facts from historical drafts so Manus can reuse\nexisting work without treating old suggestions as approved standards.\nHow Manus should use this\n•  Treat items labeled Confirmed as current operating facts or explicit founder decisions.\n•  Treat items labeled Existing draft as starter material that Rudd and Jay may correct when that role is\nactivated.\n•  Treat items labeled Missing as content still needing a JMAX definition of done. Do not silently fill those gaps\nand call them approved.\n•  Do not hard-code Bert's names into the future platform. These are the first JMAX configuration and test\ncase.\nBottom line\nThere is enough recovered material to configure the current Bert's role map and start drafting one active\nworkflow. There is not a complete, owner-approved opening, service, closing, cleaning, and checkout\nchecklist for every station.\nEvidence status key\nStatus\nMeaning\nConfirmed\nCurrent user statement or confirmed Bert's management document.\nHistorical fact\nA real earlier operating arrangement that may have changed.\nExisting draft\nPrior assistant or action-plan material, useful as a starting point but not final.\nMissing\nNo recoverable Bert-specific standard was found.\n\n\nPage 2\nBert's recovered station and role material\nPage 2\n1. Current Bert's position and assignment map\nArea\nCurrent position or\nassignment\nRecovered status and meaning\nFOH\nHost\nConfirmed current role. Seating host only.\nFOH\nSalad Bar Attendant\nConfirmed separate current position.\nFOH\nBusser\nConfirmed current position.\nFOH\nServer\nConfirmed current position.\nFOH\nFood Runner\nConfirmed current position.\nFOH\nBack Window\nConfirmed. Answers calls, assembles takeout orders, and hands orders\nto guests. Operationally FOH even though physically near BOH.\nFOH / BOH bridge\nExpo\nConfirmed bridge position between kitchen production and order\nhandoff.\nBOH\nDishwasher\nConfirmed station. Bert's schedules two dishwashers every night.\nBOH / Cook\nPizza\nConfirmed station proficiency and shift assignment.\nBOH / Cook\nFry\nConfirmed station proficiency and shift assignment.\nBOH / Cook\nSandwich\nConfirmed station proficiency and shift assignment.\nBOH / Cook\nFlat Top\nConfirmed station proficiency and shift assignment.\nBOH / Cook\nGrill\nConfirmed station proficiency and shift assignment.\nLeadership\nassignment\nFloat\nConfirmed manager-caliber oversight and rescue assignment. Not a title\nor separate qualification.\nCurrent prep rule\nBert's and Rudd's do not have a restaurant-level Prep position. Pizza, Fry, Sandwich, Flat Top, and Grill own\nthe prep required for their stations. The only dedicated Prep position exists within Bulk Prep / Hillbilly.\nPhysical kitchen flow fact\nA May 2026 conversation described the Bert's kitchen order as Expo to Dish to Back Window to the cook line,\nwith Grill, Sandwich, and Fry leading toward the oven and Pizza area. This is a layout and flow fact, not a\ncomplete responsibility checklist.\nScheduling evidence\nThe June 2026 Bert's labor budget used these scheduling families: Cook, Dishwasher, Back Window, Server,\nHost, Salad Bar, Food Runner, and Busser. The budget grouped BOH line stations under Cook rather than\ntreating each station as a separate permission role.\n\n\nPage 3\nBert's recovered station and role material\nPage 3\n2. Recovered FOH responsibilities\nHost and Salad Bar history\nHistorical fact from June 2025: daytime staffing often used one or two hosts who seated guests, maintained\nthe salad bar, and helped bus tables when time allowed. Nighttime used a dedicated seating host, a salad\nbar attendant, and a support host helping the dining room and other hosts.\nCurrent correction from August 2026: Host is now a seating host only. Salad Bar Attendant and Busser are\nseparate positions. The old combined host draft must be split before reuse.\nRecovered opening checklist material from the prior Host draft\n•  Prepare the host stand and required equipment.\n•  Prepare menus, waitlist materials, and takeout materials used at the front.\n•  Check the entry, tables, and high chairs for readiness.\n•  Review large parties, call-aheads, and reservations.\n•  Coordinate tea readiness where assigned.\n•  Check restrooms if that responsibility is assigned to the Host rather than Server or FOH management.\n•  Historical combined-role items included ice, restocking, and sanitizing the salad bar. These now belong\nwith the separate Salad Bar Attendant unless Bert's directs otherwise.\nBack Window confirmed core function\n•  Answer incoming calls.\n•  Assemble takeout orders.\n•  Hand completed orders to guests at the pickup point.\nBack Window existing management-control draft\nThe August 2026 Tim action plan proposed the following controls. They are not a final Team Member\nchecklist:\n•  Record sales, ticket count, labor hours, order corrections, remakes, and waste in one end-of-shift\nscorecard line.\n•  Staff and release Back Window labor according to call-in volume and known peaks rather than tradition\nalone.\n•  Use a bag-and-check method for call-in orders and log corrections or remakes by cause.\n•  Communicate order flow to prevent duplicate production or food being held without a guest attached.\n•  Use one consistent high-margin add-on offer where appropriate and measure the result before changing\npricing or scripts.\nFOH roles with no recovered final checklist\nNo complete owner-approved opening, service, closing, cleaning, and release checklist was recovered for Server,\nBusser, Food Runner, Expo, the current seating-only Host, or the separate Salad Bar Attendant.\n\n\nPage 4\nBert's recovered station and role material\nPage 4\n3. Recovered BOH station material\nPrior station stock lists\nIn April 2025, a prior assistant created stock-item drafts for Pizza, Sandwich, Grill, and Fry after Rudd requested\nstation checklists. The categories below are recovered draft material. They were not found as a final approved\nBert's checklist and may contain old menu items.\nStation\nRecovered draft stock categories\nGrill\nBeef patties, bacon, chicken, pulled pork, hot dogs, cheeses, and buns.\nFry\nFries, onion tanglers, ravioli, green beans, pickles, tenders, buffalo bites, onion loaf, beer cheese,\npretzels, and sauces.\nSandwich\nProduce, pickles, deli meats, meatballs, cheeses, rolls, sauces, hot dogs, and salad toppings.\nPizza\nDough, cheeses, meats, vegetables, ranch, buffalo sauce, and BBQ sauce.\nMac Bowl production draft\nA later April 2025 draft combined Pizza and Mac Bowl workflow. Recovered materials included cooked elbow\nmacaroni, cold marinara, garlic butter, Alfredo, buffalo and BBQ sauces, tins, oven, screens or pans, and a\ncold rail. A proposed load split had Sandwich build the bowls while Pizza baked, finished, and passed them to\nExpo, with an optional bake runner. This is a prior workflow draft and needs reconfirmation against the\ncurrent menu and line flow.\nWhat was not recovered\n•  No final approved stock quantities or pars for the line stations.\n•  No complete Flat Top stock or responsibility checklist.\n•  No complete opening setup standard for Pizza, Fry, Sandwich, Flat Top, Grill, Expo, or Dish.\n•  No complete service-position standard defining quality, ticket flow, communication, or rescue expectations\nby station.\n•  No complete closing cleaning and handoff checklist by line station.\n•  No final station release and verifier assignment.\n\n\nPage 5\nBert's recovered station and role material\nPage 5\n4. Dish and Prep-to-Dish standards recovered from the\ncurrent work\nConfirmed ownership standard\nZero abandoned prep dishes.\nIf a prep task or batch is complete, the employee who performed it owns the full cleanup and put-away of the\ntools, containers, and equipment used. The absence of a dishwasher does not transfer that responsibility.\nMorning Dish may inherit only items from genuinely active preparation. Those items must be scraped, rinsed,\nsoaked when appropriate, and staged so they can move directly through Dish. Abandoned work is attributed\nto the station that created it and routed to BOH management.\nCurrent Dish staffing and assignment decisions\n•  Bert's schedules two dishwashers every night.\n•  The two employees are assigned to one Dish station and share responsibility for the complete area.\n•  Do not create permanent Dirty Side and Clean Side app positions unless Bert's later decides that tracking\nis operationally useful.\n•  Proper dirty-to-clean flow belongs in the Dish operating standard and training.\n•  Morning Dish is a demanding shift assignment, not a new title or separate qualification at this stage.\nWorking arrival record\nThe current product discussion supports a simple three-condition arrival record:\nCondition\nMeaning\nReady\nDish begins normal setup.\nActive prep dishes staged correctly\nExpected live work is accepted.\nAbandoned prep dishes\nThe responsible station is recorded and the exception routes to BOH\nmanagement.\nStill unresolved\nRudd and Jay have not yet confirmed which specific role physically checks and releases the nighttime Dish team.\nThe working recommendation is one designated closing leader for that shift, but this is not yet a confirmed Bert's\nrule.\n\n\nPage 6\nBert's recovered station and role material\nPage 6\n5. Confirmed Bert's leadership responsibilities\nRole\nNamed current\nowner\nConfirmed responsibility\nOwnership\nRudd and Jay\nDirection, budgets, and major personnel decisions.\nGeneral Manager\nTim\nFull restaurant accountability, final operational decisions, priority setting,\napproval of major changes, exception resolution, and manager\naccountability.\nAssistant General\nManager\nWalter\nDaily coordination, truck ordering, vendors, and support across both\ndepartments. Builds, verifies, and places truck orders.\nKitchen Managers\nJeff and Ryan\nKitchen presence, staffing, station prep, quality, counts, pars, waste, and\nproduct needs.\nKitchen Team Lead\nDrew\nClosing leadership and nightly execution five nights each week.\nDining room\nleadership\nCurrent service\nleadership\nGuest experience and dining room execution. The recovered\nmanagement structure did not name a final detailed FOH checklist.\nConfirmed kitchen-system workflow\n•  Tim selects the next priority.\n•  Jeff develops the solution.\n•  Tim reviews and approves.\n•  Jeff trains and implements.\n•  The team uses and verifies the process.\nGuiding principle from the management alignment\nWe manage food and people. Systems exist to support both. A process is finished only when the team\nunderstands it, uses it, and it improves the operation.\n\n\nPage 7\nBert's recovered station and role material\nPage 7\n6. Existing management-control drafts\nThe August 2026 Tim action plan is a serious operating draft, but it should not be mistaken for a final\napproved station SOP. Its strongest recovered responsibilities are summarized below for Manus to reuse as\nmanagement-level starter material.\nTim / GM draft responsibilities\n•  Run a weekly one-page numbers meeting covering food and paper percentage, labor percentage, prime\ncost, primary purchases, waste, comps and voids, and major invoice changes.\n•  Own the weekly action board with one owner and one due date for every exception.\n•  Approve labor deployment against forecast sales and review planned versus actual hours.\n•  Approve purchasing plans by requiring explanations for material changes before orders are placed.\n•  Coach and hold managers accountable through short daily stand-ups and a weekly reset.\nFOH Manager draft responsibilities\n•  Document every comp, void, discount, remake, and spill before close.\n•  Set server, host, and support coverage by forecast and adjust against actual traffic.\n•  Verify high-risk modifiers and key orders before food is made.\n•  Use a defined guest-recovery approach with manager approval and a documented reason.\n•  Complete opening, mid-shift, and closing checks so the dining room is shift-ready and misses have an\nowner.\nBOH Manager draft responsibilities\n•  Build orders from forecast sales, upcoming events, on-hand product, and approved pars.\n•  Receive trucks by checking quantity, price, damage, shortages, substitutions, and credits while action is\nstill possible.\n•  Capture Fry, Pizza, Grill, and station-prep waste by product and dollar value.\n•  Check portions and recipes, correct drift immediately, and keep recipe systems aligned with actual plating.\n•  Control labels, first-in-first-out rotation, holding, and prep to forecast rather than full-batch habit.\nShared daily operating draft\n•  Use opening, mid-shift, and closing manager huddles to surface shortages, prep risk, labor moves, and\nguest recovery.\n•  Do not report a problem without naming the next action, its owner, and its due date.\n•  Do not allow a weekly unresolved item to disappear without an owner and next date.\n\n\nPage 8\nBert's recovered station and role material\nPage 8\n7. Universal closing minimum for every station\nConfirmed direction from Rudd: standard rules can apply to closing every station at\nminimum. Each station may later add unique equipment, food, and cleaning\nrequirements, but every close should begin from one shared JMAX definition of a\nresponsible handoff.\nWorking universal close standard\n•  Complete or properly transfer all active work before leaving.\n•  Store, cover, label, date, and rotate all product correctly.\n•  Restock the station to its approved closing level or record anything unavailable.\n•  Wash, sanitize, dry, and put away the tools, containers, and equipment used by the station.\n•  Clean and sanitize food-contact surfaces and the surrounding work area.\n•  Record and dispose of waste according to the station standard.\n•  Remove trash and complete assigned floor, mat, drain, and surrounding-area cleaning.\n•  Leave equipment in the correct safe overnight condition, whether shut down, cooling, charging, soaking,\nor remaining on by approved rule.\n•  Report shortages, equipment problems, safety concerns, and unfinished work before release.\n•  Leave no preventable mess or abandoned work for the next employee or shift.\n•  Complete station checkout and receive release from the authorized closing leader.\nHow station-specific standards fit\nPizza, Fry, Sandwich, Flat Top, Grill, Expo, Back Window, Salad Bar, Host, Server, Busser, Food Runner, and\nDish can inherit this common close. Their individual checklists then add only what is unique, such as fryer\nfiltering, oven cleanup, salad-bar breakdown, takeout reconciliation, dish-machine shutdown, or dining-room\nside work. Those examples are categories for later definition, not approved Bert's procedures in this\ndocument.\n\n\nPage 9\nBert's recovered station and role material\nPage 9\n8. Exact gaps Manus must not pretend are complete\nNo recoverable source contained final, owner-approved station sheets covering opening, service,\nstation-specific cleaning, closing additions, and release for every position. The universal closing minimum\nabove can serve as the shared baseline, but the following role-specific details remain genuine content gaps:\n•  Current seating-only Host definition of done.\n•  Salad Bar Attendant opening, maintenance, breakdown, sanitation, and handoff standard.\n•  Busser responsibilities and release standard.\n•  Server opening, side work, service, closing, and handoff standard.\n•  Food Runner responsibilities and release standard.\n•  Expo readiness, ticket control, communication, quality check, and closing standard.\n•  Back Window Team Member checklist separate from the recovered management scorecard.\n•  Dish opening, live service, chemical and machine checks, closing, and release standard.\n•  Pizza, Fry, Sandwich, Flat Top, and Grill opening pars, service standards, cleaning, close, and handoff\nchecks.\n•  Float responsibilities for monitoring, breaks, bottleneck rescue, and escalation.\n•  The final role authorized to release Dish and other stations at close.\nRecommended treatment\nManus should use the recovered content to draft only the next active role or workflow,\nthen ask Rudd and Jay to correct what is wrong. It should not require a complete Bert's\noperating manual before product progress, and it should not label generic restaurant\nduties as confirmed JMAX standards.\nSource register\nSource\nWhat it contributed\nCurrent Rudd and Jay Manus /\nChatGPT discussion, Aug. 22, 2026\nCurrent position map, no restaurant Prep role, Float assignment, trainer rule,\nAI context, Prep-to-Dish standard, and two nightly dishwashers.\nBert's Leadership Structure\nConfirmed names, authority, kitchen ownership, ordering ownership, and\nsystems workflow.\nTim's First Sit-Down: Bert's Operating\nAction Plan\nExisting management-control draft for Tim, FOH, BOH, and Back Window.\nBert's Labor Budget Matrix Manager\nFinal\nCurrent scheduling families used in the labor model.\nPrior conversations, Apr. 30 and Jun.\n21, 2025\nHistorical station-stock drafts and combined Host / Salad Bar operating draft.\nJMAX Operations Companion Structure\nv1.1\nCurrent product structure and confirmed separation between roles,\nassignments, capabilities, and station proficiency.\n"
    },
    {
      "id": "berts-source-66bc7e81ea8ecff7",
      "title": "Berts JMAX Operating Knowledge Base v1",
      "filename": "Berts_JMAX_Operating_Knowledge_Base_v1.md",
      "brand": "Bert’s",
      "locationId": "berts",
      "locationName": "Bert’s Hometown Grill & Pizzeria",
      "department": "Management",
      "stations": [
        "Restaurant leadership"
      ],
      "roles": [
        "Owner",
        "General Manager"
      ],
      "documentType": "Operating reference",
      "operationalUse": [
        "Reference only"
      ],
      "assignment": "Owner review and source reconciliation",
      "sourceOwner": null,
      "preparedBy": null,
      "lastApprovedDate": null,
      "approvalEvidence": null,
      "sourceStatus": "draft",
      "publicationStatus": "reference_only",
      "supersededBy": null,
      "sourcePath": "Berts/Berts_JMAX_Operating_Knowledge_Base_v1.md",
      "sha256": "66bc7e81ea8ecff7638e786d584e0a231adcf3405cd2cdae1ed9f9c7fc287ed5",
      "textSha256": "66bc7e81ea8ecff7638e786d584e0a231adcf3405cd2cdae1ed9f9c7fc287ed5",
      "capturedAt": "2026-09-10",
      "relatedVersions": [],
      "duplicates": [],
      "conflicts": [
        "host-scope",
        "station-boundaries",
        "training-approval",
        "canonical-pizza"
      ],
      "content": "---\ntitle: \"Bert's JMAX Operating Knowledge Base — Recovery v1\"\nknowledge_base_id: \"JMAX-BERTS-OPS-RECOVERY-001\"\nschema_version: \"1.0\"\nsnapshot_date: \"2026-08-28\"\nrestaurant: \"Bert's Hometown Grill & Pizzeria\"\nstatus: \"owner-review working knowledge base\"\nintended_use: \"Companion architecture, content recovery, source reconciliation, and role-module planning\"\nemployee_rollout_allowed: false\nrollout_gate: \"Current owner direction is no employee rollout until JMAX is roughly 90% complete and internally consistent.\"\nnext_documentation_target: \"Back Window\"\n---\n\n# Bert's JMAX Operating Knowledge Base — Recovery v1\n\n## 00. What this file is\n\nThis file consolidates prior Bert's operating work recovered from searchable conversation context and seventeen saved source files. It is designed to help build JMAX without turning old assistant drafts, historical checklists, or generic restaurant advice into Bert's policy by accident.\n\nThe recovery found a strong operating foundation, usable review modules for several BOH stations, and a clear Companion workflow model. It also found genuine missing procedures and several contradictions. JMAX must preserve those gaps and conflicts instead of filling them with plausible-sounding language.\n\nThis is not a claim that Bert's already has a completed owner-approved SOP for every position.\n\n## 01. Required status controls\n\nEvery operating record must carry all three status fields below.\n\n| Field | Allowed values | Meaning |\n|---|---|---|\n| `decision_status` | `approved`, `current_practice`, `working_baseline`, `draft`, `needs_decision`, `conflicted`, `superseded`, `rejected`, `unknown` | Whether Bert's has actually decided the rule |\n| `validation_status` | `validated_current`, `source_located`, `memory_recovered`, `owner_review_needed`, `manager_review_needed`, `stale`, `unverified` | How trustworthy and current the evidence is |\n| `publish_status` | `enforceable`, `reference_only`, `admin_preview`, `blocked`, `retired` | What the Companion may do with it |\n\n### Publication gate\n\n```yaml\nenforceable_when:\n  decision_status: approved\n  validation_status: validated_current\n  open_conflicts: 0\n\ndefaults:\n  current_practice: reference_only\n  memory_recovered: admin_preview\n  working_baseline: admin_preview\n  draft: admin_preview\n  needs_decision: blocked\n  conflicted: blocked\n  superseded: retired\n  rejected: retired\n```\n\nAn item marked `current_practice` may help an owner or manager review the system. It must not create a mandatory employee PASS/FIX check until it has been approved as the definition of done.\n\n## 02. JMAX truth and source hierarchy\n\nMandatory legal, safety, food-code, and manufacturer requirements are non-negotiable constraints. Inside JMAX, the operating truth layers are:\n\n1. The JMAX Constitution: purpose, chain of command, truth, learning, privacy, permission, safety, conflict, and prohibited behavior.\n2. Current owner-approved Bert's policies and employee handbooks.\n3. Current owner-approved role documents, station modules, recipes, and SOPs.\n4. Authoritative live systems for their assigned domains.\n5. Owner or GM validation of current operating practice.\n6. Attributable raw conversation decisions and corrections.\n7. Recovered conversation memory.\n8. Assistant or Manus drafts, historical material, and generic industry references.\n\nConflict rules:\n\n1. Never silently merge contradictory claims.\n2. Within the same authority level, prefer the newer and more specific source.\n3. A live system is authoritative only for its named domain.\n4. Generic RestaurantOwner material may supply useful categories, but never Bert's restaurant-specific definition of done.\n5. Assistant-generated content stays a draft until Ownership or a properly delegated authority accepts it.\n6. When a recurring gray area is settled, update JMAX so the standard no longer lives only in someone's head.\n\n## 03. Platform boundary recovered from prior work\n\nJMAX is the restaurant's living operating brain: one platform with a different experience for each person. Its recurring operating loop is:\n\n```text\nKnow the standard → Know the owner → Execute → Verify → Preserve the handoff →\nRoute the exception → Close the issue → Learn from the pattern\n```\n\nThe Companion is conversation-first for context, interpretation, exceptions, disagreement, coaching, and follow-up. Structured controls own repetitive known-answer actions such as `Ready`, `PASS`, `FIX`, `Done`, `Accept`, and `Dispute`.\n\nHourly employees do not live in the app during service and do not receive an unrestricted general chatbot. Managers and owners receive deeper AI help according to explicit capability and data-scope rules.\n\n## 04. Entity model: do not call everything a role\n\n| Entity type | Bert's examples | Rule |\n|---|---|---|\n| Authority tier | Owner, GM, FOH/BOH Manager, Shift Leader, Team Member | Establishes the authority ceiling and default experience, not every permission |\n| Position | Host, Server, Dishwasher | The employee's job position |\n| Station proficiency | Pizza, Fry, Sandwich, Flat Top, Grill | Where the employee can execute; not an authority tier |\n| Shift assignment | Morning Dish, closing lead, scheduled station | What the employee is doing that shift; does not create permanent access |\n| Capability | Verify checkout, place truck order, Certified Trainer | Explicit action or visibility permission |\n| Leadership assignment | Float | Manager-caliber monitoring and rescue assignment; not a separate title or qualification |\n\nConfirmed corrections:\n\n1. Morning Dish is an assignment, not a separate job title.\n2. Two nightly Dish employees share one Dish area. Dirty-side and clean-side separation is required operating behavior, not two app roles or permanent positions.\n3. Bert's has no restaurant-level Prep position. Pizza, Fry, Sandwich, Flat Top, and Grill own the prep their stations require. Dedicated Prep exists only in the separate Bulk Prep operation.\n\n## 05. Role-only leadership map\n\nThis mapping preserves responsibility without tying the operating system to current employees. Assign people separately during account provisioning.\n\n| Level | Recovered ownership | Status |\n|---|---|---|\n| Ownership | Direction, budgets, major personnel decisions, owner-only commitments | Confirmed role scope |\n| GM | Full-unit accountability, priorities, final operational decisions, manager accountability, major exception resolution | Confirmed role scope |\n| AGM | Daily coordination, vendors, cross-department support, builds/verifies/places truck orders | Confirmed role scope |\n| Kitchen Manager | Kitchen presence, staffing, station prep, quality, counts, pars, waste, product needs | Confirmed functional scope; decision rights still need review |\n| Kitchen Team Lead | Closing leadership and nightly execution when assigned | Confirmed functional scope; schedule-specific assignment |\n| FOH leadership | Guest experience and dining-room execution | Role definition and decision rights incomplete |\n\nConfirmed management-system sequence:\n\n1. The GM selects the priority.\n2. The assigned Kitchen Manager develops the solution.\n3. The GM reviews and approves it.\n4. The assigned Kitchen Manager trains and implements it.\n5. The team uses and verifies it.\n\nA process is not finished merely because a document exists. It is finished when the team understands it, uses it, and it improves the operation.\n\n## 06. Current Bert's position and station catalog\n\n| Area | Position, station, or assignment | Confirmed meaning | Module status |\n|---|---|---|---|\n| FOH | Host | Seating-only current position | Missing full current module |\n| FOH | Salad Bar Attendant | Separate current position | Missing |\n| FOH | Busser | Separate current position | Missing |\n| FOH | Server | Separate current position | Missing |\n| FOH | Food Runner | Separate current position | Missing |\n| FOH | Back Window | Answers calls, assembles takeout orders, hands completed orders to guests; operationally FOH | Core confirmed; full team-member module missing |\n| FOH/BOH bridge | Expo | Bridge between kitchen production and order handoff | Missing |\n| BOH | Dishwasher / Dish | One shared station; two employees every night | Strongest detailed module; exact configuration still needed |\n| BOH/Cook | Pizza/Oven | Station proficiency and shift assignment | Working review module located |\n| BOH/Cook | Fry | Station proficiency and shift assignment | Working review module located |\n| BOH/Cook | Sandwich | Station proficiency and shift assignment | Working review module located; strongest direct station source |\n| BOH/Cook | Flat Top | Station proficiency and shift assignment | Missing |\n| BOH/Cook | Grill | Station proficiency and shift assignment | Working review module located |\n| Leadership assignment | Float | Manager-caliber oversight and rescue assignment | Missing definition |\n\n## 07. Confirmed cross-position operating rules\n\n### STD-BOH-001: Station ownership and prep\n\n```yaml\ndecision_status: approved\nvalidation_status: source_located\npublish_status: admin_preview\n```\n\nEach BOH station owns the preparation required for its work. A completed prep task includes cleaning, drying, putting away, and resetting the tools, containers, equipment, and area used.\n\n### STD-BOH-002: Zero abandoned prep dishes\n\n```yaml\ndecision_status: approved\nvalidation_status: source_located\npublish_status: admin_preview\n```\n\nCompleted prep work does not transfer to Dish because a dishwasher has not arrived. Only genuinely active prep ware may transfer, and it must be scraped, rinsed, soaked when appropriate, or staged for immediate Dish processing. Abandoned work is attributed to the creating station, routed to BOH management, and excluded from Dishwasher performance.\n\n### STD-BOH-003: Universal closing foundation\n\n```yaml\ndecision_status: approved\nvalidation_status: source_located\npublish_status: admin_preview\napproval_scope: \"The shared-closing architecture is approved; the detailed checklist still requires review.\"\n```\n\nOwnership confirmed that every station can inherit one shared closing foundation. The detailed list below is still a working baseline until reviewed:\n\n1. Complete active work or explicitly transfer it to a named person.\n2. Store, cover, label, date, rotate, or safely discard product.\n3. Restock to the approved closing level or record what is unavailable.\n4. Clean, sanitize, dry, and put away station prep tools and containers.\n5. Clean and sanitize food-contact surfaces.\n6. Record and dispose of waste by the approved station process.\n7. Complete assigned trash, floors, mats, drains, walls, and surrounding zones.\n8. Leave equipment in its approved overnight state.\n9. Report shortages, equipment failures, safety concerns, and unfinished work before release.\n10. Leave no preventable mess or abandoned work for the next person or shift.\n11. Receive checkout and release from the authorized leader where required.\n\nThe named release authority is confirmed for Dish. Extending that same verifier pattern to every other station is a strong design candidate, not yet an owner-approved rule.\n\n### STD-BOH-004: Exception evidence, not surveillance\n\nNormal work should require a short status and verifier record where applicable. Pictures are useful for a disputed inherited condition, equipment failure, unusual quality issue, or unresolved exception. Routine photos of every close are not the operating model.\n\n### STD-BOH-005: Lowest capable escalation\n\nRoutine corrections stay with the Team Member and lowest authorized leader able to fix them. Repeated or ignored patterns rise to the department manager and GM. Owners receive serious, unresolved, systemic, or ignored-management issues, not routine station noise.\n\n## 08. Manager operating system\n\n### Daily management foundation\n\nOwnership accepted three daily management priorities:\n\n1. People\n2. Product\n3. Restaurant\n\nThe recovered management philosophy is that managers create daily control, the GM owns weekly accountability, and owners handle only work that cannot be delegated. Managers ensure standards and verification; they are not expected to personally perform every employee task or quietly repair every failure.\n\n### Strong 3:00 p.m. readiness pattern\n\nThe recovered Bert's operating description says a strong BOH manager is present by roughly 3:00 p.m., has walked the stations, established prep lists, inherited a clean handoff, and is ready to run an alley rally so the team is prepared around 4:00 p.m.\n\nThe weak pattern is taking a break near the transition, returning as service begins, skipping the rally, walk, or prep setup, and entering survival mode. A later owner correction noted that even returning at 3:00 after a 2:00 break fails if the next hour is spent merely reorienting. JMAX should distinguish personal preparation failure from a schedule that gave the manager no real capacity to prepare.\n\n### Kitchen Manager working baseline\n\nThe Kitchen Manager module is structurally strong but remains a review baseline.\n\n| Cadence | Recovered working responsibilities |\n|---|---|\n| One to two days before | Review coverage, qualifications, call-offs, overtime exposure, probable station plan, product shortages, deliveries, maintenance, and events |\n| Opening/preshift | Confirm attendance and coverage; walk freezers/walk-in; verify labels/rotation/product; physically line-check critical stations; assign cleaning owners/verifiers; set stations, Float, breaks, and escalation |\n| Service | Stay present; reject failed food by naming the failed standard; recheck risk stations; adjust labor before the opportunity passes; own communication channels; delegate with named owner and due time |\n| Shift change/close | Verify outgoing condition and incoming acceptance/dispute; review waste/remakes, stock/pars, cleaning, and unresolved work; assign next action, owner, due time, escalation |\n\nCleaning-control draft:\n\n```text\nAssign → Define what done means → Complete → Named physical verification →\nCorrect by the responsible person when possible → Escalate repeated or unsafe misses\n```\n\nInitials alone are not proof.\n\n### GM control draft\n\nThe recovered GM action plan is a management-control draft, not an approved GM SOP. The reusable controls are:\n\n1. One-page Monday numbers review for food/paper, labor, prime cost, primary purchases, waste, comps/voids, and major invoice changes.\n2. One action board with one owner and due date for every exception.\n3. Labor deployment reviewed against forecast and planned-versus-actual hours.\n4. Material purchasing changes explained before orders are placed.\n5. Short daily manager stand-up plus weekly reset.\n6. No weekly issue silently disappears without an owner and next date.\n\n### FOH management draft\n\n1. Record reason, dollar value, server, and approving manager for every comp, void, discount, remake, and spill before close.\n2. Build Server, Host, and support coverage to forecast and deliberately adjust to actual traffic.\n3. Verify high-risk modifiers and repeat key orders before production.\n4. Use an approved guest-recovery ladder and record issue, action, approval, and cost.\n5. Complete opening, mid-shift, and close checks; give every miss an owner.\n\n### Back Window management draft\n\n`Back Window Manager` is an accountability label in an old plan, not a confirmed position title.\n\nCandidate controls:\n\n1. One end-of-shift line for sales, ticket count, labor hours, corrections, remakes, and waste.\n2. Start and release labor based on call-in volume and known peaks.\n3. Use a bag-and-check process and log every correction/remake by cause.\n4. Communicate with the kitchen to prevent duplicate production or held food with no guest attached.\n5. Test one appropriate add-on offer and measure it before changing scripts or prices.\n\nThese controls do not replace the missing Back Window Team Member opening, service, reconciliation, cleaning, closing, and release standard.\n\n### Proof and issue closure\n\nThe strongest reusable draft rule is: if an important exception is not recorded that day, management cannot reliably close it.\n\nEvery material issue record should contain:\n\n| Field | Requirement |\n|---|---|\n| Context | Date, shift, restaurant, department, station, and assignment |\n| Condition | What happened and which standard failed |\n| Impact | Guest, food, labor, cost, safety, or operating impact |\n| Immediate correction | What was done now |\n| Owner | One accountable person |\n| Timing | Due date or next review time |\n| Verification | Named approver/verifier where required |\n| Closure | Evidence, final result, and closed status |\n\n## 09. Bert's labor scheduling guide\n\nDollar budgets by projected weekly sales:\n\n| Position family | $52k sales | $54k sales | $56k sales | $58k sales |\n|---|---:|---:|---:|---:|\n| Cook | $4,950 | $5,100 | $5,300 | $5,500 |\n| Dishwasher | $2,200 | $2,250 | $2,350 | $2,450 |\n| Back Window | $950 | $1,000 | $1,025 | $1,050 |\n| Server | $725 | $750 | $775 | $800 |\n| Host | $750 | $775 | $800 | $825 |\n| Salad Bar | $750 | $800 | $825 | $850 |\n| Food Runner | $50 | $75 | $75 | $75 |\n| Busser | $50 | $50 | $50 | $75 |\n\nManager rules in the current labor guide:\n\n1. Build schedules from projected weekly sales and remain within position budgets when possible.\n2. Overtime is allowed when needed; material overtime must be explainable.\n3. Total labor dollars matter more than overtime hours alone.\n4. Food quality, service, and cleanliness take priority over blind cuts.\n5. If one area exceeds its budget, offset elsewhere when possible without damaging operations.\n6. Keep Back Window labor separately visible.\n\nOpen configuration: treatment between/outside the four sales bands, management-labor treatment, Expo's budget family, forecast lock time, and final offset authority.\n\n## 10. Dishwasher operating recovery\n\nDish is the most complete recovered station and contains several explicit founder decisions.\n\n### Confirmed role boundaries\n\n1. Two employees are assigned nightly to one shared Dish position and jointly own the whole area.\n2. Dirty-to-clean separation is required behavior; JMAX does not create separate Dirty Side/Clean Side roles.\n3. Dish owns the complete area while assigned. Completed-prep cleanup stays with the creating station.\n4. Inherited abandoned, overnight, or dried ware is attributed to the prior station/shift and excluded from Dish scoring.\n5. One specifically assigned BOH Manager, Shift Leader, or authorized closing manager verifies and releases Dish. `Any available manager` is not sufficient.\n6. Unsafe machine, temperature, or chemical condition stops the affected operation and requires immediate leader notification.\n7. A human leader, not AI, decides PASS, release, coaching, and performance action.\n\n### Three-hour machine refresh\n\nThe newer three-hour instruction supersedes the older four-hour wording.\n\n1. Drain the machine.\n2. Remove and clean screens.\n3. Clear or inspect spray arms/jets.\n4. Wipe the interior.\n5. Refill.\n6. Confirm chemicals and operating temperature.\n7. Record `Completed` or `Problem`.\n\nThe timer begins when the machine enters service and resets after a completed refresh. When refresh is due at the 3:00 p.m. handoff, it occurs before incoming Dish accepts responsibility.\n\nExact approved temperature, chemical, test method, machine ID, and vendor procedure remain configuration gaps. The three-hour cadence is founder input; it is not a substitute for vendor or regulatory validation.\n\n### Three Dish control points\n\n1. Morning arrival\n2. 3:00 p.m. responsibility handoff\n3. Final close and release\n\nPassing 3:00 condition in the recovered controlling notes includes lunch ware processed, dry, and put away; no dried or abandoned pans; usable clean/dirty flow; controlled trash; correct chemicals; any due refresh completed; only active service ware staged; and unfinished work honestly disclosed with reason and first priority. High volume is not automatically a failure. Surprise is the failure.\n\nHandoff sequence:\n\n```text\nOutgoing Ready → Named leader PASS/FIX → Correction or documented exception →\nIncoming Accept/Dispute before changing the area → Manager resolution\n```\n\nA Dispute names the failed standard and may include one useful picture.\n\n### Source-backed v1.1 close zones needing current approval/configuration\n\n1. Clean-rack availability\n2. Dirty and clean Dish-table condition\n3. Machine drained/cleaned\n4. Removable components cleaned and staged for overnight air-drying\n5. Floors and drains\n6. Trash and dumpster zone\n7. Pans and racks\n8. Chemical condition\n9. Rinsed dustpans\n10. Properly stored mops and brooms\n11. Emptied mop buckets\n12. Unresolved facility problem routing\n\n## 11. BOH station review modules\n\nThese four modules are source-backed review structures, not approved executable SOPs. All inherit the Shared BOH Core.\n\n### Sandwich\n\n| Phase | Recovered working content |\n|---|---|\n| Opening | Start approved equipment; check sandwich table and storage below; pull bread for forecast volume; maintain walk-in bread racks; confirm ingredients and pasta sauce; disclose shortages/bad product/equipment |\n| Service | Refill before runout; manage bread and sauce safely; backup-stock to-go boxes when assigned; follow recipe/portion/timing/temperature/presentation; clean as work occurs; warn Expo/BOH before flow fails |\n| Close | Approved toaster procedure; microwaves; lowboy interior/doors; sandwich-table flip/transfer and cleaning; secure product; approved equipment shutdown; leader release |\n| Missing | Current menu/pars, bread-pull formula, sauce rule, cleaning methods, exact meaning of flip/cover, shutdown list, verifier |\n\nHistorical Sandwich stock and the Mac Bowl workflow are validation prompts only.\n\n### Fry\n\n| Phase | Recovered working content |\n|---|---|\n| Opening | Inspect for leaks/damage/unsafe oil; use approved startup; confirm baskets, skimmers, timers, tongs, pans, PPE, waste controls, product, landing area, and fire/safety access |\n| Service | Approved bread/batter/portion/load/timing/drain/season/hold; avoid overloading or unapproved product mixing; reject failed product; communicate backlog; maintain oil/equipment at approved cadence |\n| Close | Safe product/breading/sauce disposition; approved oil filter/test/retain/replace/disposal; fryer and zone cleaning; waste record; authorized release |\n| Missing/blocking | Current menu/pars, cook and hold values, oil triggers, hot-oil method, PPE/fire procedure, startup/shutdown/cleaning, verifier |\n\nJMAX must block unsafe fryer answers when those values are not approved.\n\n### Grill\n\n| Phase | Recovered working content |\n|---|---|\n| Opening | Inspect/start equipment; confirm tools and thermometer; check approved product; enforce raw/cooked separation, labels/dates/rotation; organize cook/landing/finish/handoff flow |\n| Service | Cook only by approved specification and doneness method; follow seasoning/portion/finish; coordinate Expo timing; maintain separation and temperatures; raise delay/shortage/remake/equipment problems |\n| Close | Store/label/rotate/discard product; clean and stage tools; approved grill/grease procedure; overnight equipment state; assigned area; leader release |\n| Missing/blocking | Current station menu, pars, recipes, times, doneness, temperatures, allergen/cross-contact controls, cleaning, equipment state, zone, verifier |\n\nHistorical Grill lists must not assign burgers or other Flat Top work to Grill. Grill-versus-Flat-Top ownership requires a current menu map.\n\n### Pizza/Oven\n\n| Phase | Recovered working content |\n|---|---|\n| Opening | Inspect/preheat approved oven; confirm screens/pans/peels/cutters/gloves/landing; check dough/toppings/sauces/freshness/labels/dates/rotation; organize build/bake/finish/handoff |\n| Service | Build by recipe/portion/sequence; load/rotate/monitor/remove; verify doneness/cut/finish/presentation; coordinate shared production with Sandwich and Expo; control station buildup |\n| Close | Secure/label/date/rotate dough and toppings; secure cold rail/sauces; clean and air-dry tools; safe oven-area cleaning; approved overnight oven state; transfer active shared work; leader release |\n| Missing/blocking | Current menu, baked-sandwich ownership, Mac Bowl decision, bake standards, oven procedure, pars, verifier |\n\nThe earlier Pizza/Oven module is not the recoverable version of the later claimed `Pizza Make` universal-template document. Do not let the older nine-section module overwrite newer work if the missing source is recovered.\n\n## 12. FOH recovery\n\n### Host\n\nCurrent correction: Host is seating-only. The prior combined Host/Salad Bar/Busser model is superseded.\n\nHistorical material that may be evaluated for the new seating-only module:\n\n1. Host stand and required equipment\n2. Menus and waitlist material\n3. Entry, tables, and high chairs\n4. Parties, call-aheads, and reservations\n5. Tea or restroom checks only if Bert's explicitly assigns them\n\nDo not return ice, salad-bar restocking, salad sanitation, or bussing duties to Host without a new owner decision. Older Host go-home duties involving salad-bar topping/stocking are superseded by the later seating-only correction.\n\n### Salad Bar Attendant\n\nSeparate current position. Needs opening, stocking, quality, food-safety, maintenance, sanitation, breakdown, handoff, checkout, and release definitions.\n\n### Busser\n\nSeparate current position. No usable owner-approved opening, service, cleaning, handoff, checkout, or release standard recovered.\n\n### Server\n\nSeparate current position. Needs opening, side work, service sequence, guest recovery, closing, handoff, checkout, and release standards.\n\n### Food Runner\n\nSeparate current position. Needs readiness, ticket/order verification, running, communication, cleaning, handoff, checkout, and release standards.\n\n### Back Window\n\nConfirmed core purpose:\n\n1. Answer incoming calls.\n2. Assemble takeout orders.\n3. Hand completed orders to guests at pickup.\n\nCurrent owner direction treats Back Window as a critical FOH communication channel covering phones/orders, quotes, and kitchen coordination. The exact team-member module remains missing.\n\n### Expo\n\nConfirmed FOH/BOH bridge. Needs readiness, ticket control, station communication, order completeness, quality verification, handoff, cleaning, closing, checkout, and release standards.\n\n## 13. Training and proficiency\n\nConfirmed architecture:\n\n1. Station proficiency uses five levels.\n2. Station skill and authority are separate.\n3. Training ability and station mastery are separate.\n4. An employee may train a station only at Level 4 or Level 5 and with separate Certified Trainer capability.\n5. Level 5 alone does not make someone a trainer.\n6. A Level 4 employee may be an excellent trainer.\n\nThe exact Level 1 through Level 5 definitions, required observations, evaluator hierarchy, tests, number of successful shifts, manager sign-off, and final mastery mechanics remain proposed or missing. Do not hard-code them from the older drafts.\n\n## 14. Verified shift handoff\n\nThis is the strongest first Companion loop.\n\n```text\nAssignment context\n  → Employee Ready\n  → Authorized verifier checks critical conditions\n  → PASS or FIX\n  → Employee corrects or manager records an exception\n  → Handoff record is preserved\n  → Incoming employee Accepts or Disputes before material use\n  → Manager resolves\n  → AI detects recurrence and verifier anomalies\n  → Escalation follows the lowest-capable-person rule\n```\n\nKnown rules:\n\n1. Conversation starts the context and handles ambiguity.\n2. PASS/FIX and Accept/Dispute are structured controls.\n3. The employee fixes failed work when operationally safe; the manager does not quietly patch everything.\n4. A shared close requires explicit transfer, a named next owner, remaining exceptions, and authorized release.\n5. A Dispute identifies the failed standard; one useful picture and short explanation may support an exception.\n6. Photos are exception evidence, not routine surveillance.\n7. Toast clock-out remains separate. JMAX may use a soft operational gate; it must not claim hard clock-out enforcement.\n\nMissing before enforcement across all stations:\n\n1. Critical handoff conditions per station\n2. Authorized verifier and backup per shift\n3. No-verifier/release policy\n4. Accept/Dispute arrival window\n5. Evidence rule per type of exception\n6. Resolution deadlines and escalation recipients\n\n## 15. Employee Issue → Manager Resolution\n\nThis is the exact second loop after verified handoff.\n\n1. Employee raises a bounded work, training, feedback, or workplace issue.\n2. AI organizes it as informational, operational, or manager-actionable.\n3. The employee sees the visibility category and decides whether to share when consent is required.\n4. The named manager receives a structured issue.\n5. The manager records a commitment, owner, and due time.\n6. JMAX follows up until closure or escalation.\n7. Ignored work rises to GM, then to Owner only under the approved deadline and threshold.\n\nVisibility categories:\n\n1. Private to me\n2. Operational record\n3. Share with manager\n4. Safety/legal escalation\n\nConsent occurs when data crosses a boundary and names the recipient. Private employee conversations must never be silently searched by management AI or used in scheduling, promotion, discipline, or scoring.\n\nExact acknowledgement deadlines, closure deadlines, retention, safety reviewer, and serious-event routing remain open.\n\n## 16. Permissions and AI\n\n### Experience by authority tier\n\n| Tier | Primary Companion experience |\n|---|---|\n| Team Member | Bounded schedule, assignment, duties, standards, training, focus, checkout, feedback, and work-issue route |\n| Shift Leader | Readiness, missing work, breaks, checkouts, disputed handoffs, corrective assignments, coaching prompts |\n| FOH/BOH Manager | Preshift brief, labor/OT alerts, station readiness, volume/events, service exceptions, maintenance, coaching, open commitments |\n| GM | Full-unit execution, manager follow-through, staffing depth, labor/sales trends, compliance, maintenance, training coverage, repeated failures |\n| Owner | Cross-entity or entity-scoped operating intelligence, unresolved/systemic patterns, owner commitments, strategic and non-delegable decisions |\n\n### Permission model\n\nEvery request evaluates restaurant/legal entity, role, department, relationship, current assignment, capability grant, and data type. Today's assignment may prioritize the interface but may not silently grant access.\n\n### Pay-visibility conflict and controlling instruction\n\nOlder August 22 documents say individual pay rates do not render below Owner. A later direct owner instruction says the GM should see nearly everything the Owner sees, including individual pay rates.\n\nCurrent treatment:\n\n```yaml\ndecision_status: approved\ndecision_basis: \"later owner instruction\"\ncontrolling_rule: \"GM may see individual employee pay rates within the GM's authorized restaurant scope.\"\nrequired_action: \"Amend older owner-only permission documents and keep Kitchen Manager access separately configurable.\"\n```\n\nDo not assume every Manager receives GM visibility. GM access remains location-scoped and excludes private employee Companion conversations.\n\n### Human-decision boundary\n\nAI may detect, organize, summarize, explain, recommend, route, and draft. A responsible human decides hiring, termination, discipline, compensation, promotion, station certification, safety fitness, harassment findings, legal compliance, and other consequential employment actions.\n\n## 17. Authoritative systems and integration boundaries\n\n| Domain | Current authority | JMAX role |\n|---|---|---|\n| Bert's schedule | HotSchedules | Read/display when reliable; do not dual-enter; migrate only after JMAX earns reliability |\n| Other JMAX restaurant schedule | Sling | Same boundary |\n| Sales, orders, checks, punches, menu, kitchen events | Toast | Read, interpret, route, summarize; current standard access is read-only |\n| Bert's operating standards | JMAX owners/managers | Define and approve restaurant-specific standards |\n| Generic control categories | RestaurantOwner material | Drafting categories only |\n| Bulk Prep | Existing live Bulk Prep application | Remains authoritative; JMAX may later read plan/status/late/shortage/transfer/usage/waste exceptions |\n| Payroll/pay actions | Toast Payroll/current payroll system | Permission-controlled; no unproven write claims |\n| Accounting | QuickBooks/vendor records | Later owner/authorized finance workflows |\n\nToast access does not prove data integrity. Inventory, schedule, reservation, party, and cost recommendations require a named reliable source for each claim.\n\n## 18. Universal 25-section role-template recovery\n\nThe current project requires one universal 25-section template for every Bert's role and station. Conversation recovery found only these 21 named sections:\n\n1. Role purpose\n2. Responsibilities\n3. Required knowledge\n4. Certification/training\n5. Setup\n6. Pre-shift\n7. During-shift\n8. Peak-volume execution\n9. Quality\n10. Sanitation\n11. Closing\n12. Handoff\n13. Common mistakes\n14. Troubleshooting\n15. Escalation\n16. Safety\n17. Equipment\n18. Related SOPs\n19. Performance expectations\n20. Development path\n21. Change history\n22. `TBD — not recoverable`\n23. `TBD — not recoverable`\n24. `TBD — not recoverable`\n25. `TBD — not recoverable`\n\nThe prior conversation called this a 25-section template, but the recoverable list contains 21 headings. Do not invent the missing four. The canonical template is blocked until the original source is recovered or Ownership deliberately defines the missing sections.\n\nThe same prior conversation states that `Pizza Make` was the first full role completed. No saved Pizza Make universal-template file was found. The Library contains only the older August 22 `Pizza/Oven Station Module — v1`, which uses a different structure and remains a review draft. Treat Pizza Make as `claimed_complete_but_source_missing`; do not overwrite it with the older module.\n\n```yaml\ntemplate_id: \"JMAX-ROLE-TEMPLATE-25\"\nrequired_section_count: 25\nrecoverable_named_sections: 21\nmissing_section_names: 4\nstatus: \"blocked_missing_canonical_source\"\n\npizza_make:\n  claimed_status: \"first full role completed\"\n  canonical_file_recovered: false\n  older_pizza_oven_module_is_equivalent: false\n```\n\n## 19. Conflict and supersession register\n\n| ID | Topic | Conflicting claims | Controlling treatment |\n|---|---|---|---|\n| CON-001 | Universal template | Called 25 sections; only 21 names recoverable | Block four slots; do not invent |\n| CON-002 | Pizza Make | Claimed complete; canonical content not saved/recovered | Preserve claim and gap; older Pizza/Oven module cannot replace it |\n| CON-003 | Dish machine refresh | Older four-hour wording versus newer three-hour founder instruction | Three hours controls provisionally; retain four-hour wording only as superseded provenance |\n| CON-004 | Host scope | Historical Host combined seating/Salad Bar/bussing versus current seating-only Host | Seating-only controls; separate Salad Bar and Busser roles |\n| CON-005 | Schedule platform | Old KM says Sling every Monday; Bert's uses HotSchedules | Publish by approved deadline in the current authoritative system; platform stored by location |\n| CON-006 | Labor target | Draft says 22% daily labor without reliable scope | Candidate only; do not hard-code |\n| CON-007 | GM pay visibility | Older documents say Owner-only; later owner instruction says GM may see rates | Later owner instruction controls; revise documents and scope to GM's restaurant |\n| CON-008 | Baked sandwiches | Pizza/Oven source includes them while Sandwich is separate | Needs current station-owner decision |\n| CON-009 | Mac Bowls | Historical Sandwich → Pizza → Expo workflow | Legacy candidate; do not activate |\n| CON-010 | Burger ownership | Historical Grill stock lists include burgers; Flat Top is separate | Do not assign to Grill until current menu/station map approves it |\n| CON-011 | Dish roles | Two employees versus Dirty/Clean app-role split | One shared Dish station; dirty/clean flow is behavior, not role |\n| CON-012 | Prep role | Historical drafts mention Prep at restaurant level | No restaurant-level Prep; station-owned prep; Bulk Prep separate |\n| CON-013 | Salaried-person overtime example | An old AI example treats a salaried leader as overtime-exposed | Replace the example with a generic hourly employee |\n| CON-014 | Toast clock-out | Suggested hard checkout gate versus current read-only access | Soft operational gate only; no claim of time-clock enforcement |\n| CON-015 | QA result | 51/51 checks may look like operational approval | QA proves structural consistency only, not founder approval or current accuracy |\n\n## 20. Completion and gap matrix\n\n| Role, station, or workflow | Recovered strength | Approval/currentness | App readiness | Highest-priority gap |\n|---|---|---|---|---|\n| JMAX Constitution | Topics and layer recovered | Full canonical text not recovered | Blocked as canonical source | Save/locate the Constitution file |\n| Universal 25-section template | 21 headings recovered | Four headings missing | Blocked | Recover or define four sections |\n| Pizza Make 25-section role | Claimed complete | Canonical source missing | Blocked | Recover original file/thread content |\n| Shared BOH Core | Strong source-backed structure | Owner review needed | Admin preview | KEEP/CHANGE/DELETE review |\n| Kitchen Manager | Strong working module | Authority and thresholds unresolved | Admin preview | Decision rights and current values |\n| Dishwasher | Strongest detailed module; several confirmed controls | Equipment/chemical/site values missing | Partial/admin preview | Current machine, temperature, chemical, close-zone configuration |\n| Sandwich | Strong working source | Not owner-approved | Admin preview | Current menu, pars, methods, verifier |\n| Fry | Strong structure | Safety-critical values missing | Blocked for procedural enforcement | Oil, temp, PPE, equipment, cleaning procedures |\n| Grill | Strong structure | Menu and safety values missing | Blocked for procedural enforcement | Grill-vs-Flat-Top map, doneness/temp/cleaning |\n| Pizza/Oven | Strong older structure | Not the missing Pizza Make source | Admin preview only | Current ownership and oven/bake procedures |\n| Flat Top | Position confirmed | No module | Blocked | Full role/station module |\n| Back Window | Core function confirmed; management draft exists | Team Member module missing | Blocked | Full 25-section module; current documentation priority |\n| FOH Manager | Management draft exists | Current role/person/authority incomplete | Blocked | Full module and decision rights |\n| Server | Position confirmed | No module | Blocked | Full module |\n| Host | Seating-only correction confirmed | No current full module | Blocked | Full seating-only module |\n| Salad Bar Attendant | Separate position confirmed | No module | Blocked | Full module |\n| Busser | Position confirmed | No module | Blocked | Full module |\n| Food Runner | Position confirmed | No module | Blocked | Full module |\n| Expo | Bridge confirmed | No module | Blocked | Ticket/quality/handoff module |\n| Float | Assignment concept confirmed | Detailed duties missing | Blocked | Monitoring, breaks, rescue, escalation |\n| Shift Leader | Authority tier/product duties recovered | Bert's-specific authority incomplete | Blocked | Verification/release/escalation rights |\n| Verified handoff | Strong product workflow | Station criteria and SLAs missing | Admin preview | Per-station PASS/FIX and verifier rules |\n| Employee Issue → Manager Resolution | Strong second-loop design | SLAs/privacy routing not complete | Blocked | Consent, recipient, deadline, retention decisions |\n| Labor scheduling guide | Exact current matrix located | Boundary/config questions remain | Reference only | Forecast bands, Expo/management treatment |\n\n## 21. Companion data objects required by the recovered system\n\nMinimum objects:\n\n| Object | Core fields |\n|---|---|\n| `OperatingStandardRevision` | ID, restaurant/department/station scope, definition of done, decision/validation/publish status, source, approver, effective date, supersedes |\n| `RoleTemplate` | Tier, default capability bundle, authority ceiling |\n| `CapabilityGrant` | Person, capability, restaurant/legal-entity scope, department scope, effective dates |\n| `ShiftAssignment` | Person, shift, station/position, service period |\n| `StationProficiency` | Person, station, level, evidence, reviewer, effective date |\n| `TrainerQualification` | Person, station scope, Certified Trainer status, approver |\n| `AccountableWorkItem` | Standard, responsible person, cadence, due time, evidence, status, verifier, escalation |\n| `ShiftHandoff` | Outgoing, station, Ready time, verifier, PASS/FIX, corrections, incoming, Accept/Dispute, status |\n| `DisputeEvidence` | Failed standard, short explanation, optional photo, submitter, time |\n| `Exception` | Category, impact, immediate correction, owner, due time, resolution, recurrence key |\n| `Escalation` | Source record, responsible level/person, deadline, history, resolution |\n| `EmployeeIssue` | Classification, visibility category, share consent, named recipient, manager commitment, due time, closure |\n| `ConsentEvent` | Employee, information category, named recipient, disclosure text, time |\n| `AuditEvent` | Security or material operating action in a separate authorization path |\n\nEvery screen, prompt, and automation must filter by decision, validation, and publish status. Draft, conflicted, legacy, or missing-source content must not appear to an employee as settled policy.\n\n## 22. Current project constraints\n\n1. Bert's is the reference restaurant.\n2. Standards live in JMAX, not solely in a person's head.\n3. Do not conduct employee or manager interviews; the prior interview recommendation was overruled.\n4. Do not roll JMAX out to Bert's employees until it is roughly 90% complete and internally consistent.\n5. Forms and printable manager tools must use readable 12–14 point text, large writing areas, large checkboxes, and realistic end-of-shift burden.\n6. Team Members should not continuously operate the app during service.\n7. Bulk Prep remains authoritative and must not be rebuilt merely for architectural neatness.\n8. Custom restaurant titles/hierarchies are allowed; capability primitives and scoped permissions are the standard layer.\n\n## 23. Current documentation order\n\nThe most recently recovered order is:\n\n1. Back Window\n2. FOH Manager\n3. Server\n4. Host, Busser, Food Runner, Salad Bar Attendant, and Expo\n5. Remaining BOH gaps, especially Flat Top\n6. Leadership and cross-position workflows\n\nDish, Shared BOH, Kitchen Manager, Sandwich, Fry, Grill, and the older Pizza/Oven material should be preserved as recovery sources and reviewed, not rebuilt from scratch before this sequence advances.\n\n## 24. Source registry\n\n### Current recovery sources\n\n| Source ID | File or context source | Use | Authority treatment |\n|---|---|---|---|\n| SRC-001 | Recent JMAX Constitution and universal-template conversation memory | Project intent, layers, 25-section requirement, documentation order | Memory recovered; canonical files missing |\n| SRC-002 | `JMAX_Operations_Companion_—_Structure_v1.1.pdf` | Product, role, capability, workflow, permission, systems model | Mixed confirmed direction and working structure |\n| SRC-003 | `Restaurant_Companion_—_Independent_Validation_and_Reconciliation.pdf` | Red-team boundaries, privacy, first/second loop, system limits | Independent recommendation, not policy |\n| SRC-004 | `Restaurant_Companion_—_Forced-Decision_Register.pdf` | Open decisions and working recommendations | Questions/candidates, not decisions |\n| SRC-005 | `Berts_Recovered_Station_Roles_and_Checklist_Material.pdf` | Current role map, historical corrections, missing modules | Confirmed facts plus clearly labeled historical/draft material |\n| SRC-006 | Bert's GM operating action-plan source | Management-control draft | Draft requiring approval |\n| SRC-007 | `Berts_Labor_Budget_Matrix_Manager_Final.pdf` | Scheduling dollar guide and manager rules | Current manager guide; configuration boundaries open |\n| SRC-008 | `Bert’s Shared BOH Core Standard — v1.md` | Shared BOH inheritance | Working review baseline |\n| SRC-009 | `Bert’s Kitchen Manager Module — v1.md` | KM cadence, outcomes, authority candidates | Working review baseline |\n| SRC-010 | `Bert’s Dishwasher Operating Module — v1.1.md` | Dish boundaries, handoff, three-hour control, close zones | Mixed confirmed founder rules and configuration |\n| SRC-011 | `Bert’s Sandwich Station Module — v1.md` | Sandwich review module | Working baseline |\n| SRC-012 | `Bert’s Fry Station Module — v1.md` | Fry review module | Working baseline; safety values missing |\n| SRC-013 | `Bert’s Grill Station Module — v1.md` | Grill review module | Working baseline; ownership/safety values missing |\n| SRC-014 | `Bert’s Pizza _ Oven Station Module — v1.md` | Older Pizza/Oven review module | Working baseline; not the missing Pizza Make file |\n| SRC-015 | `JMAX Batch 001–007 Normalization Map.md` | Conflict and gap map | Structural reconciliation |\n| SRC-016 | `JMAX Role Module QA Results.md` | 51/51 structural checks | Consistency only, not operational approval |\n| SRC-017 | `JMAX_BOH_Operating_Library_—_Batch_1_Review_Packet.pdf` | Review sequence and packet summary | Review-only packet |\n| SRC-018 | `Batch_1_Controlling_Review_Notes.pdf` | Narrow approval boundary and corrections | Controlling review notes |\n| SRC-019 | Searchable prior conversation context | Host corrections, manager foundations, UI/form constraints, later permission decisions | Attribute and reconcile before enforcement |\n\n## 25. Next operating action\n\nThe recovered material is sufficient to stop re-explaining the entire JMAX vision each time and to prevent old drafts from being mistaken for policy.\n\nThe next content build should be the Back Window universal role module because:\n\n1. It is already first in the approved documentation order.\n2. Its core purpose is confirmed.\n3. It is a major FOH/kitchen communication channel.\n4. A management-control draft exists to mine without pretending it is the Team Member standard.\n5. The exact opening, call handling, order capture/quote, kitchen coordination, assembly/checking, guest handoff, reconciliation, cleaning, closing, and release procedures remain genuinely missing.\n\nBefore Back Window can use the universal role template, recover or deliberately complete the four missing section names in the claimed 25-section master structure.\n"
    }
  ],
  "conflicts": [
    {
      "id": "host-scope",
      "title": "Host duties conflict",
      "detail": "The Host job description and training checklist combine seating, salad bar, bussing and phone/to-go work. The recovered operating knowledge base records a later seating-only Host correction with separate roles. Confirm the current role boundary before publishing either checklist.",
      "documentIds": [
        "berts-source-59d7c543de85b96b",
        "berts-source-2a833dcd11eb4257",
        "berts-source-66bc7e81ea8ecff7"
      ],
      "status": "unresolved"
    },
    {
      "id": "pizza-version",
      "title": "Pizza reset versions need reconciliation",
      "detail": "The two reset files differ: v2 adds the crumb-catch-tray requirement. The separate BOH requirements include oven shutdown; the other requirements apply before 11AM, before 4PM and at close. Approve which requirements apply at which reset, and confirm the missing product and equipment methods. A filename does not establish replacement.",
      "documentIds": [
        "berts-source-33e78221f2adffbf",
        "berts-source-67d68d064444ee1c",
        "berts-source-907730c0da0f5a04",
        "berts-source-5c4abd3e324c8827"
      ],
      "status": "unresolved"
    },
    {
      "id": "prep-values",
      "title": "Prep and shelf-life values need approval",
      "detail": "The pull/thaw and bulk/thaw sheets cover different products; the daily-prep variants include repeated content. Shelf lives, units, prep days, quantities and responsibility need current approval. The Cod rows in the pull/thaw sheets need reconciliation before any quantity is calculated.",
      "documentIds": [
        "berts-source-e45b7c3babe5a7e7",
        "berts-source-ca142b1727a5da72",
        "berts-source-5ab97d9aca37835a",
        "berts-source-6fbcb115dd24baad",
        "berts-source-48162cfeb9000201"
      ],
      "status": "unresolved"
    },
    {
      "id": "leadership-history",
      "title": "Historical names must not grant access",
      "detail": "The Daily Operations versions name historical managers, keyholders and bank-bag responsibilities. They differ in owner duties and personnel coverage. Keep these as owner reference; current employee access and shift leadership come from the authorized app records.",
      "documentIds": [
        "berts-source-0cbee0e18b2be6ab",
        "berts-source-e1134aec3819c332"
      ],
      "status": "unresolved"
    },
    {
      "id": "station-boundaries",
      "title": "Cook station ownership is unresolved",
      "detail": "The recovery flags baked-sandwich ownership between Sandwich and Pizza/Oven, burger ownership between Grill and Flat Top, and a historical Mac Bowl flow. Do not create current station duties from those unresolved overlaps.",
      "documentIds": [
        "berts-source-51b6cb7c7b3cfdb9",
        "berts-source-0b44b5698e3dd208",
        "berts-source-828b3f9344eec0a2",
        "berts-source-66bc7e81ea8ecff7"
      ],
      "status": "unresolved"
    },
    {
      "id": "training-approval",
      "title": "Training levels and sign-off are not defined",
      "detail": "The recovered knowledge base says the exact Level 1–5 definitions and evaluator/sign-off rules remain proposed or missing. The independent review recommends a different four-level scheme. No scale, trainer status or individual clearance is approved by this intake.",
      "documentIds": [
        "berts-source-66bc7e81ea8ecff7"
      ],
      "status": "unresolved"
    },
    {
      "id": "missing-methods",
      "title": "Equipment and cleaning controls need confirmation",
      "detail": "The station modules label equipment, chemicals, methods, timing and verifiers as configuration needed. The older FOH closing checklist names a nozzle-soaking method without current approval evidence. These sources are review material, not instructions for an employee to follow.",
      "documentIds": [
        "berts-source-0e4d8d311f37aa79",
        "berts-source-655fc5318ae8b461",
        "berts-source-828b3f9344eec0a2",
        "berts-source-f8ce9d11586f8029",
        "berts-source-0b44b5698e3dd208",
        "berts-source-51b6cb7c7b3cfdb9",
        "berts-source-0591b88a39d18631"
      ],
      "status": "unresolved"
    },
    {
      "id": "canonical-pizza",
      "title": "Canonical Pizza Make source remains missing",
      "detail": "The recovered knowledge base distinguishes the older Pizza/Oven module from the claimed completed 25-section Pizza Make document. This intake has not located that canonical document; the older module must not silently replace it.",
      "documentIds": [
        "berts-source-0b44b5698e3dd208",
        "berts-source-66bc7e81ea8ecff7"
      ],
      "status": "unresolved"
    }
  ]
};
