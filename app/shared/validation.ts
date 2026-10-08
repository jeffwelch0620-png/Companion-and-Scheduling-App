export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function requireThat(condition: unknown, message: string, status = 400): asserts condition { if (!condition) throw new AppError(status, message); }
export function object(value: unknown): Record<string, unknown> {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, name: string, max = 2000, optional = false): string {
  requireThat(typeof value === 'string', `${name} must be text.`);
  const result = value.trim();
  requireThat((optional || result.length > 0) && result.length <= max, `${name} is required and must be at most ${max} characters.`);
  return result;
}
export function id(value: unknown): string { const result = text(value, 'Identifier', 100); requireThat(/^[a-zA-Z0-9_-]+$/.test(result), 'Invalid identifier.'); return result; }
export function instant(value: unknown, name = 'Time'): string {
  const result = text(value, name, 40);
  requireThat(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(result) && Number.isFinite(Date.parse(result)), `${name} must include a valid date, time, and time zone.`);
  const date=result.slice(0,10);
  requireThat(new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)===date && Number(result.slice(11,13))<24, `${name} must use a real calendar date and time.`);
  return new Date(result).toISOString();
}
export function range(input: Record<string, unknown>, maxHours = 24 * 60) {
  const start = instant(input.start, 'Start'), end = instant(input.end, 'End');
  const duration = Date.parse(end) - Date.parse(start);
  requireThat(duration > 0 && duration <= maxHours * 3600000, `The end must follow the start within ${maxHours} hours.`);
  return { start, end };
}
export function overlaps(a: {start: string; end: string}, b: {start: string; end: string}) { return a.start < b.end && b.start < a.end; }
