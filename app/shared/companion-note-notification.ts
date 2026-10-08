import {requestsCorrectionNote} from './companion-correction-note';

/** A requested factual note must not turn a needed follow-up into a completed
 * notification. A direct user report remains a report, not app delivery proof. */
export function checkedNoteNotification(question:string,answer:string):string{
 if(!requestsCorrectionNote(question))return answer;
 const reported=/\b(?:i|we)(?:['’]ve|\s+have)?\s+(?:(?:already|just)\s+)?(?:told|notified|messaged|contacted|called)\b/i.test(question)&&!/\b(?:if|unless|haven['’]t|have not|didn['’]t|did not|not yet)\b/i.test(question);
 if(reported)return answer;
 const revised=answer.replace(/\b(?:the\s+)?manager\s+(?:has been\s+|was\s+|already\s+)?notified\s*\/?\s*/gi,'Manager follow-up needed: ');
 if(revised===answer)return answer;
 return revised+'\n\nThis draft does not record a notification. State that someone was notified only after confirming that contact actually happened; needing follow-up is not a completed notification.';
}
