import { has, manages, type Member, type RecordOf, type Workspace } from './types';
import { requireThat, text } from './validation';

export function canPublish(me: Member, area: string) { return manages(me, area, 'schedule.publish'); }

export function assignedLeader(w: Workspace, me: Member, area: string, period: {start: string; end: string}) {
  return w.records.some(r => r.kind === 'leadership' && r.data.active && r.data.personId === me.id && r.data.area === area && r.data.start <= period.start && r.data.end >= period.end);
}

export function canChangePublished(w: Workspace, me: Member, area: string, period: {start: string; end: string}) {
  return has(me, 'schedule.change') && (has(me, 'location.manage') || (manages(me, area, 'schedule.change') && assignedLeader(w, me, area, period)));
}

export function calendarDate(value: unknown, label: string) {
  const date = text(value, label, 10);
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date, `${label} must be a real calendar date.`);
  return date;
}

// Compare real instants with local wall-clock restrictions. Iterating bounded minute
// intervals handles skipped/repeated DST times and shifts crossing local midnight.
// Rules are minute-granular; every intersecting minute of the shift is checked.
export function availabilityConflict(w: Workspace, personId: string, period: {start: string; end: string}): RecordOf<'availability'> | undefined {
  const rules = w.records.filter((r): r is RecordOf<'availability'> => r.kind === 'availability' && r.ownerId === personId && r.data.status === 'approved');
  if (!rules.length) return;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: w.location.timezone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' });
  for (let time = Math.floor(Date.parse(period.start) / 60000) * 60000; time < Date.parse(period.end); time += 60000) {
    const parts = Object.fromEntries(formatter.formatToParts(time).map(p => [p.type, p.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`, minute = Number(parts.hour) * 60 + Number(parts.minute);
    for (const offset of [-1, 0, 1]) {
      const anchor = new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86400000), day = anchor.toISOString().slice(0,10), relativeMinute = minute - offset * 1440;
      const match = rules.find(r => day >= r.data.startDate && day <= r.data.endDate && !r.data.excludedDates?.includes(day) && r.data.days.includes(anchor.getUTCDay()) && relativeMinute >= r.data.startMinute - r.data.beforeMinutes && relativeMinute < r.data.endMinute + r.data.afterMinutes);
      if (match) return match;
    }
  }
}
