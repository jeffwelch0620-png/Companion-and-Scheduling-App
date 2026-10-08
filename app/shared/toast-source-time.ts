import {instant,text,requireThat} from './validation';

// Toast/Supabase source timestamps may retain PostgreSQL microseconds or finer
// ISO fractions. Preserve strict calendar/offset validation before representing
// them at JavaScript's millisecond precision. User-entered times are unchanged.
export function toastSourceInstant(value:unknown,name='Source time'):string {
 const source=text(value,name,40);
 requireThat(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(source),`${name} must include a valid date, time, and time zone.`);
 return instant(source.replace(/(\.\d{3})\d+(?=Z|[+-]\d{2}:\d{2}$)/,'$1'),name);
}
