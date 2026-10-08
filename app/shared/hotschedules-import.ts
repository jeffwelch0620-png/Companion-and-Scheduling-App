import { nextDate } from './local-time';
import { requireThat } from './validation';

export type ImportedShift={employee:string;date:string;start:string;end:string;endsNextDay:boolean;minutes:number;schedule:string;job:string;meal:string;break:string;sourceRow:number};
export type ImportedWeek={weekStart:string;weekEnd:string;shifts:ImportedShift[];employees:number;minutes:number;days:{date:string;shifts:number;minutes:number}[];warnings:string[]};
export type SavedSchedule=ImportedWeek&{id:string;fileName:string;importedAt:string;timezone:string};
export type ScheduleImportView={weeks:{id:string;weekStart:string;importedAt:string}[];saved:SavedSchedule|null};
const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
export function scheduleDate(value:unknown):string {
  requireThat(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Choose a valid first day of the exported week.');
  requireThat(value>='2000-01-01'&&value<='2100-12-24','Choose a week between 2000 and 2100.');return value;
}

// Strict quoted CSV parsing, including escaped quotes and multiline cells.
// Unknown columns are rejected rather than storing contact or payroll fields.
function csvRows(csv:string):string[][] {
  requireThat(new TextEncoder().encode(csv).byteLength<=100000,'Choose a weekly roster smaller than 100 KB.',413);
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
  const field=()=>{row.push(cell.trim());cell='';closed=false;requireThat(row.length<=36,'Export the Weekly Roster with phone numbers turned off.');};
  const record=()=>{field();if(row.some(Boolean))rows.push(row);row=[];requireThat(rows.length<=1001,'This export has too many rows. Export one week.');};
  csv=csv.replace(/^\uFEFF/,'');
  for(let i=0;i<csv.length;i++){
    const c=csv[i];
    if(quoted){if(c==='"'){if(csv[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;}
    else if(c===',')field();
    else if(c==='\r'||c==='\n'){if(c==='\r'&&csv[i+1]==='\n')i++;record();}
    else if(c==='"'){requireThat(!cell&&!closed,'The CSV contains an invalid quoted field.');quoted=true;}
    else {requireThat(!closed||c===' '||c==='\t','The CSV contains text after a closing quote.');if(!closed)cell+=c;}
    requireThat(cell.length<=500,'A roster field is too long.');
  }
  requireThat(!quoted,'The CSV ends inside a quoted field.');
  if(cell||row.length||closed)record();return rows;
}
const present=(value:string)=>value!==''&&value!=='-';
function clock(hour:string,minute:string,period:string){
  const h=Number(hour),m=Number(minute);requireThat(h>=1&&h<=12&&m<60,'A shift contains an invalid time.');
  return (h%12+(period==='PM'?12:0))*60+m;
}
export function parseHotSchedules(csv:string,weekValue:unknown,fileName=''):ImportedWeek {
  const weekStart=scheduleDate(weekValue),dayIndex=new Date(weekStart+'T12:00:00Z').getUTCDay();
  const dates=Array.from({length:7},(_,i)=>nextDate(weekStart,i));
  const encoded=/^Weekly_Roster_(\d{2})(\d{2})(\d{4})_(\d{2})(\d{2})(\d{4})(?: \(\d+\))?\.csv$/i.exec(fileName);
  if(encoded)requireThat(`${encoded[3]}-${encoded[1]}-${encoded[2]}`===weekStart&&`${encoded[6]}-${encoded[4]}-${encoded[5]}`===dates[6],'The selected dates do not match the week in this filename.');
  const rows=csvRows(csv),expected=['Employee',...dates.flatMap((_,i)=>['Shift','Schedule','Job','Meal','Break'].map(field=>`${weekdays[(dayIndex+i)%7]} ${field}`))];
  requireThat(rows.length>1&&JSON.stringify(rows[0])===JSON.stringify(expected),'Use the Weekly Roster CSV with meals and breaks included, phone numbers off, and the correct first day selected.');
  const shifts:ImportedShift[]=[],seen=new Set<string>();
  rows.slice(1).forEach((row,index)=>{
    requireThat(row.length===36,`Roster row ${index+2} does not have all seven days.`);
    const employee=row[0];requireThat(present(employee)&&employee.length<=160,`Roster row ${index+2} needs an employee name.`);
    for(let d=0;d<7;d++){
      const [time,schedule,job,meal,rest]=row.slice(1+d*5,6+d*5);
      if(!present(time)){requireThat([schedule,job,meal,rest].every(v=>!present(v)),`Roster row ${index+2} has details without a shift time.`);continue;}
      const match=/^(\d{1,2}):(\d{2}) (AM|PM) - (\d{1,2}):(\d{2}) (AM|PM)$/i.exec(time);
      requireThat(match,`Roster row ${index+2} has an unrecognized shift time. Export exact start and end times.`);
      requireThat(present(schedule)&&present(job)&&schedule.length<=120&&job.length<=160,`Roster row ${index+2} needs a schedule and job.`);
      const start=clock(match[1],match[2],match[3].toUpperCase()),end=clock(match[4],match[5],match[6].toUpperCase());
      requireThat(start!==end,`Roster row ${index+2} has equal start and end times. Clarify that shift before importing.`);
      const shift:ImportedShift={employee,date:dates[d],start:time.split(' - ')[0].toUpperCase(),end:time.split(' - ')[1].toUpperCase(),endsNextDay:end<start,minutes:(end-start+1440)%1440,schedule,job,meal:present(meal)?meal:'',break:present(rest)?rest:'',sourceRow:index+2};
      const key=JSON.stringify([employee,shift.date,start,end,schedule,job]);
      requireThat(!seen.has(key),`Roster row ${index+2} repeats the same employee, job and shift. Check the export for duplicates.`);seen.add(key);shifts.push(shift);
    }
  });
  requireThat(shifts.length>0&&shifts.length<=2000,'Export one week containing between 1 and 2,000 shifts.');
  const warnings:string[]=[];
  const byEmployee=new Map<string,Array<{start:number;end:number}>>();
  for(const s of shifts){
    const toMinute=(v:string)=>{const m=/^(\d+):(\d+) (AM|PM)$/.exec(v)!;return clock(m[1],m[2],m[3]);};
    const start=dates.indexOf(s.date)*1440+toMinute(s.start),end=start+s.minutes;
    const intervals=byEmployee.get(s.employee)??[];if(intervals.some(v=>v.start<end&&start<v.end)&&!warnings.includes('Some shifts overlap for the same name. Review those assignments.'))warnings.push('Some shifts overlap for the same name. Review those assignments.');
    intervals.push({start,end});byEmployee.set(s.employee,intervals);
  }
  if(shifts.some(s=>s.meal||s.break))warnings.push('Meal and break details are shown as exported. They have not been deducted from the displayed hours.');
  return {weekStart,weekEnd:dates[6],shifts,employees:new Set(shifts.map(s=>s.employee)).size,minutes:shifts.reduce((sum,s)=>sum+s.minutes,0),days:dates.map(date=>({date,shifts:shifts.filter(s=>s.date===date).length,minutes:shifts.filter(s=>s.date===date).reduce((sum,s)=>sum+s.minutes,0)})),warnings};
}
