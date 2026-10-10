import forbidden from './configuration-whitespace.json' with {type:'json'};
import timezones from './store-timezones.json' with {type:'json'};
const whitespace=new Set(forbidden),zones=new Set(timezones);
export const isConfigurationLabel=value=>typeof value==='string'&&value===value.trim()&&Array.from(value).length>0&&Array.from(value).length<=100&&!Array.from(value).some(c=>whitespace.has(c.codePointAt(0)));
export function isConfigurationTimezone(value) {
 if(!zones.has(value))return false;
 try{new Intl.DateTimeFormat('en-US',{timeZone:value});return true;}catch{return false;}
}
