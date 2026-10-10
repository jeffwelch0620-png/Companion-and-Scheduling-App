// Candidate-only form policy. Names are explicit store metadata, never grants.
// Match 041: PostgreSQL btrim removes outer ASCII spaces before collapsing whitespace.
const normalized=value=>value.replace(/^ +| +$/g,'').toLowerCase().replace(/\s+/g,' ');
const label=value=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=100;
export function configuredLocation(location) {
 const c=location?.configuration;
 const list=(values,max)=>Array.isArray(values)&&values.length>0&&values.length<=max&&values.every(label);
 if(!label(location?.id)||!Number.isInteger(location?.revision)||location.revision<0||typeof location?.timezone!=='string'||location.timezone!==location.timezone.trim()||!location.timezone||
  !list(c?.operatingDepartments,16)||new Set(c.operatingDepartments).size!==c.operatingDepartments.length||!label(c.dishDepartment)||!c.operatingDepartments.includes(c.dishDepartment)||!label(c.dishPosition)||
  !list(c.dishAliases,64)||new Set(c.dishAliases.map(normalized)).size!==c.dishAliases.length||!c.dishAliases.map(normalized).includes(normalized(c.dishPosition)))throw Error('Store configuration is unavailable. Reload before using these forms.');
 try{new Intl.DateTimeFormat('en-US',{timeZone:location.timezone});}catch{throw Error('Store timezone is unavailable. Reload before using these forms.');}
 return location;
}
export const storeConfiguration=w=>configuredLocation(w.location).configuration;
export const isCheckoutPosition=(w,position)=>position===storeConfiguration(w).dishPosition;
export const isCheckoutLabel=(w,value)=>typeof value==='string'&&storeConfiguration(w).dishAliases.some(alias=>normalized(alias)===normalized(value));
export const checkoutPeople=w=>w.members.filter(m=>m.locationId===w.location.id&&m.area===storeConfiguration(w).dishDepartment&&isCheckoutPosition(w,m.position)&&!m.scheduleOnly);
export function operationsManager(w,member,area=member.area) {
 const c=storeConfiguration(w),has=cap=>member.capabilities.includes(cap);
 return member.locationId===w.location.id&&!member.scheduleOnly&&!isCheckoutPosition(w,member.position)&&(has('location.manage')||has('tasks.manage')&&(member.area===area||has('operations.store')&&c.operatingDepartments.includes(area)));
}
export function departmentOrder(w,area) {
 const index=storeConfiguration(w).operatingDepartments.indexOf(area);
 return index<0?storeConfiguration(w).operatingDepartments.length:index;
}
