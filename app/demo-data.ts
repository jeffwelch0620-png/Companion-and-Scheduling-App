export type Tier = "Team Member" | "Shift Leader" | "Department Manager" | "GM" | "Owner";
export type Person = { id:string; name:string; initials:string; position:string; tier:Tier; area:"BOH"|"FOH"|"Bridge"|"Executive"; shift:string };
export type Task = { id:string; time:string; state:"now"|"next"|"later"|"required"; title:string; summary:string; why:string; steps:string[]; options:string[] };
export type MessageKind = "Direct" | "Shift" | "Position" | "Announcement";
export type TeamMessage = { id:string; kind:MessageKind; from:string; fromRole:string; audience:string; subject:string; body:string; time:string; targetIds?:string[]; targetPosition?:string; targetArea?:Person["area"]; leadershipOnly?:boolean; ackRequired?:boolean; acknowledgedBy:string[]; replies:{from:string;text:string;time:string}[]; attachments?:string[] };
export type NewMessageDraft = { kind:MessageKind; audience:string; subject:string; body:string; attachments:string[] };
export type VoiceEvent = { results:{[index:number]:{[index:number]:{transcript:string}}} };
export type VoiceRecognition = { lang:string;interimResults:boolean;continuous:boolean;start:()=>void;stop:()=>void;onresult:((event:VoiceEvent)=>void)|null;onerror:(()=>void)|null;onend:(()=>void)|null };
export type VoiceWindow = Window & { SpeechRecognition?:new()=>VoiceRecognition;webkitSpeechRecognition?:new()=>VoiceRecognition };

export const people: Person[] = [
  ["maya","Maya","MC","Dishwasher","Team Member","BOH","10:00 AM–4:00 PM"],
  ["eli","Eli","EB","Dishwasher","Team Member","BOH","3:00 PM–Close"],
  ["noah","Noah","NB","Pizza/Oven","Team Member","BOH","4:00 PM–Close"],
  ["lena","Lena","LP","Fry","Team Member","BOH","10:00 AM–4:00 PM"],
  ["marcus","Marcus","MR","Sandwich","Team Member","BOH","3:00 PM–Close"],
  ["tessa","Tessa","TB","Flat Top","Team Member","BOH","4:00 PM–Close"],
  ["owen","Owen","OS","Grill","Team Member","BOH","10:00 AM–4:00 PM"],
  ["ava","Ava","AD","Expo","Team Member","Bridge","3:00 PM–Close"],
  ["casey","Casey","CM","Host","Team Member","FOH","4:00 PM–Close"],
  ["harper","Harper","HL","Salad Bar Attendant","Team Member","FOH","10:00 AM–4:00 PM"],
  ["devin","Devin","DG","Busser","Team Member","FOH","4:00 PM–Close"],
  ["sofia","Sofia","SE","Server","Team Member","FOH","4:00 PM–Close"],
  ["mateo","Mateo","MF","Food Runner","Team Member","FOH","4:00 PM–Close"],
  ["riley","Riley","RS","Back Window","Team Member","FOH","3:00 PM–Close"],
  ["jordan","Jordan","JL","Shift Leader","Shift Leader","Bridge","3:00 PM–Close"],
  ["sam","Sam","SW","Float","Shift Leader","Bridge","4:00 PM–Close"],
  ["renee","Renee","RC","BOH Manager / Kitchen Manager","Department Manager","BOH","11:00 AM–9:00 PM"],
  ["avery","Avery","AB","FOH Manager","Department Manager","FOH","11:00 AM–9:00 PM"],
  ["taylor","Taylor","TM","General Manager","GM","Executive","Restaurant day"],
  ["walter","Walter Demo","WD","Assistant General Manager","Department Manager","BOH","Restaurant day"],
  ["tim","Tim Demo","TD","Purchasing reviewer","GM","Executive","Restaurant day"],
  ["owner-all","Jay Demo","JD","Owner","Owner","Executive","4 authorized businesses"],
  ["owner-limited","Rudd Demo","RD","Owner","Owner","Executive","Bert’s · Rudd’s · Bulk Prep"],
].map(([id,name,initials,position,tier,area,shift]) => ({id,name,initials,position,tier: tier as Tier,area:area as Person["area"],shift}));

export const station: Record<string,{purpose:string;focus:string;close:string;issue:string}> = {
  Dishwasher:{purpose:"Keep clean ware moving without inheriting abandoned work",focus:"Protect clean and dirty flow",close:"Drain and fully clean the machine",issue:"machine, chemicals, volume, or abandoned prep"},
  "Pizza/Oven":{purpose:"Build, bake, finish, and hand off approved oven items",focus:"Build approved items to recipe standards",close:"Store dough and leave the oven in approved condition",issue:"dough shortage, oven behavior, or bake quality"},
  Fry:{purpose:"Control fry quality, timing, and safe oil operation",focus:"Protect cook times and product quality",close:"Secure oil and reset the fry station",issue:"product shortage, oil condition, or equipment"},
  Sandwich:{purpose:"Build accurate cold and hot sandwiches at service pace",focus:"Keep builds accurate and the rail controlled",close:"Rotate product and reset bread and cold storage",issue:"product shortage, temperature, or build flow"},
  "Flat Top":{purpose:"Run flat-top production with safe temperatures and clean transitions",focus:"Control surface zones and ticket timing",close:"Leave the surface in approved condition",issue:"temperature, product, or equipment"},
  Grill:{purpose:"Deliver correctly cooked grill items during peak demand",focus:"Protect doneness, timing, and safe handling",close:"Clean grates, tools, and surrounding station",issue:"temperature, product, or grill operation"},
  Expo:{purpose:"Protect accuracy, presentation, and communication at the handoff",focus:"Stop incomplete plates before service",close:"Reset the pass, tools, and communication area",issue:"missing food, ticket conflict, or quality"},
  Host:{purpose:"Set the pace and first impression of the dining room",focus:"Manage the wait and seat guests accurately",close:"Reset menus, entry, and host information",issue:"guest flow, wait estimate, or coverage"},
  "Salad Bar Attendant":{purpose:"Keep the salad bar fresh, safe, and guest ready",focus:"Protect temperature, freshness, and presentation",close:"Store product and fully clean the bar",issue:"temperature, product, or sanitation"},
  Busser:{purpose:"Turn tables quickly without sacrificing cleanliness",focus:"Keep dining and service paths clear",close:"Reset dining room tools, trash, and floors",issue:"table backlog, spill, or coverage"},
  Server:{purpose:"Own the guest experience from greeting through payment",focus:"Protect accuracy, pace, and communication",close:"Complete checkout and assigned side work",issue:"guest concern, ticket delay, or payment"},
  "Food Runner":{purpose:"Move complete orders quickly to the correct guests",focus:"Verify destination and protect food quality",close:"Reset trays, stands, and runner paths",issue:"missing item, table conflict, or delay"},
  "Back Window":{purpose:"Answer calls, assemble takeout, and complete guest pickup",focus:"Protect order accuracy and pickup timing",close:"Reconcile orders and reset pickup",issue:"call volume, order mismatch, or guest wait"},
  Float:{purpose:"Watch the whole shift and move help to the first real bottleneck",focus:"Protect flow without taking ownership away from each station",close:"Confirm every open exception has a named owner",issue:"coverage, bottleneck, guest impact, or unresolved handoff"},
};

export function tasksFor(p:Person):Task[]{
  const c=station[p.position]??station.Dishwasher;
  const start=p.shift.startsWith("10")?"10:00":p.shift.startsWith("3")?"3:00":"4:00";
  return [
    {id:"arrival",time:start,state:"now",title:`${p.position} arrival readiness`,summary:"Confirm the station, people, product, and equipment before service changes the picture.",why:"A clean starting condition separates inherited problems from the work your shift owns.",steps:["Check in with the assigned leader","Confirm today’s assignment and shift notes",`Check for ${c.issue}`,"Report anything materially unready"],options:["Ready","Need help","Product shortage","Equipment problem","Ask JMAX"]},
    {id:"service",time:start==="10:00"?"11:00":"4:30",state:"next",title:c.focus,summary:"A short check as the shift changes from setup to execution.",why:"The best time to correct weak setup is before volume turns it into a service problem.",steps:["Confirm the station can handle expected volume","Resolve or disclose shortages","Know who receives the first help request"],options:["On track","Need help","Report a problem","Ask JMAX"]},
    {id:"handoff",time:p.shift.startsWith("10")?"3:00 PM":"Shift change",state:p.shift.startsWith("10")?"required":"later",title:"Responsibility handoff",summary:"Outgoing reports condition, leader verifies, incoming accepts or disputes.",why:"Communication makes disclosed carryover manageable. Surprise makes it a failed handoff.",steps:["Describe unfinished or active work","Identify the incoming person and any carryover","Request leader verification"],options:["Ready for verification","Need help","Explain carryover","Ask JMAX"]},
    {id:"close",time:"Close",state:"later",title:`${p.position} final close`,summary:`${c.close}. Complete universal close and receive physical release.`,why:"The next shift should inherit a controlled station, not yesterday’s unfinished work.",steps:["Store, label, rotate, or dispose of product","Clean the station and work paths","Remove trash and reset shared tools",c.close,"Request physical checkout and release"],options:["Start close","Need help","Report incomplete work","Ask JMAX"]},
  ];
}

export const exceptions=[
  {level:"NOW",area:"Pizza/Oven",title:"Abandoned prep ware",detail:"Completed sauce prep was left at Dish before Maya arrived.",owner:"Renee · BOH Manager",tone:"amber"},
  {level:"3:00 PM",area:"Fry",title:"Handoff verification",detail:"Station ready with one disclosed low-stock item.",owner:"Jordan · Shift Leader",tone:"green"},
  {level:"RECURRING",area:"Sandwich",title:"Three close corrections",detail:"The same closing standard missed in three of the last seven shifts.",owner:"Taylor · GM",tone:"red"},
];
export const toastEmployees=[
  {name:"Maria Santos",job:"Cook",wage:"$17.25",status:"NEW",map:"Team Member · Fry + Grill",confidence:"91%"},
  {name:"Caleb Price",job:"Manager",wage:"$22.50",status:"CHANGED",map:"Department Manager · BOH",confidence:"78%"},
  {name:"Nina Foster",job:"Server",wage:"$2.13",status:"MATCHED",map:"Team Member · Server",confidence:"98%"},
];

export const initialTeamMessages:TeamMessage[]=[
  {id:"service-focus",kind:"Announcement",from:"Taylor",fromRole:"GM",audience:"Bert’s · All staff",subject:"Friday service focus",body:"Tonight’s focus is clean handoffs. Disclose unfinished work before the next person accepts the station. A surprise is a failed handoff; disclosed carryover can be managed.",time:"2:18 PM",ackRequired:true,acknowledgedBy:["maya","jordan","renee","avery"],replies:[]},
  {id:"coverage-update",kind:"Shift",from:"Jordan",fromRole:"Shift Leader",audience:"Tonight · 3:00 PM–Close",subject:"Back Window coverage at 4:00",body:"Riley opens Back Window. Sam is the first Float response if phone volume and pickup volume hit together.",time:"2:36 PM",acknowledgedBy:[],replies:[{from:"Sam",text:"Got it. I’ll check the window before the dinner push.",time:"2:41 PM"}]},
  {id:"dish-handoff",kind:"Position",from:"Renee",fromRole:"BOH Manager",audience:"Dishwasher",targetPosition:"Dishwasher",subject:"Dish arrival standard",body:"If prep work is complete, the person who created the dishes owns cleanup. Record abandoned prep work at arrival so Dish is not blamed for an inherited backlog.",time:"1:52 PM",ackRequired:true,acknowledgedBy:["maya"],replies:[]},
  {id:"eli-direct",kind:"Direct",from:"Jordan",fromRole:"Shift Leader",audience:"Eli · Direct operational message",targetIds:["eli","jordan"],subject:"Tonight’s two-person Dish assignment",body:"You are starting clean side. Check with Maya at 3:00 before changing sides, then keep put-away moving during the dinner push.",time:"2:44 PM",acknowledgedBy:[],replies:[]},
  {id:"manager-loop",kind:"Direct",from:"Taylor",fromRole:"GM",audience:"Bert’s leadership",leadershipOnly:true,subject:"Close the Sandwich pattern tonight",body:"The same closing standard missed three times in seven shifts. Renee owns the coaching. Jordan verifies the handoff. Send me the result, not every step.",time:"12:20 PM",ackRequired:true,acknowledgedBy:["renee"],replies:[{from:"Renee",text:"Coaching is assigned before service. Jordan has the close condition.",time:"1:05 PM"}]},
];

