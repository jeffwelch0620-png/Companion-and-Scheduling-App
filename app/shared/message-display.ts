import { displayTime } from './local-time';

// Render existing scheduling notices in restaurant time without rewriting their
// saved evidence or changing employees' free-form messages and replies.
export function schedulingNoticeText(title:string,body:string,zone:string){
  if(!['Shift published','Shift cancelled','Your schedule changed','Shift leadership assigned','Closing assignment'].includes(title))return body;
  return body.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})\b/g,instant=>{
    if(!Number.isFinite(Date.parse(instant)))return instant;
    return displayTime(instant,zone);
  });
}
