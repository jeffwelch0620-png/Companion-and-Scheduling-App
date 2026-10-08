import { boundedJson } from './service';
import { object, requireThat, text, AppError } from './validation';

export type ToastPerson = { toastEmployeeId: string; name: string; email: string | null; archived: boolean; jobs: { toastJobId: string; title: string; archived: boolean }[]; issues: string[] };
export type ToastRoster = { restaurantGuid: string; retrievedAt: string; employees: ToastPerson[]; issues: string[] };

// Preserve upstream identifiers and all assigned jobs. Never match people solely by name.
// Explicit field selection discards passcodes, phone numbers, wages, and payroll data.
export function normalizeToastRoster(employeesValue: unknown, jobsValue: unknown, restaurantGuid: string, retrievedAt = new Date().toISOString()): ToastRoster {
  requireThat(Array.isArray(employeesValue) && employeesValue.length <= 2000 && Array.isArray(jobsValue) && jobsValue.length <= 500, 'Toast returned an unexpected roster.', 502);
  const jobs = new Map<string, { toastJobId: string; title: string; archived: boolean }>();
  for (const value of jobsValue) {
    const row = object(value), toastJobId = text(row.guid, 'Toast job ID', 100);
    requireThat(!jobs.has(toastJobId), 'Toast returned duplicate job identifiers.', 502);
    jobs.set(toastJobId, { toastJobId, title: text(row.title, 'Toast job title', 150), archived: row.deleted === true });
  }
  const ids = new Set<string>(), emails = new Map<string, number>();
  const employees = employeesValue.map(value => {
    const row = object(value), toastEmployeeId = text(row.guid, 'Toast employee ID', 100);
    requireThat(!ids.has(toastEmployeeId), 'Toast returned duplicate employee identifiers.', 502); ids.add(toastEmployeeId);
    const firstName = typeof row.chosenName === 'string' && row.chosenName.trim() ? row.chosenName : row.firstName;
    const name = `${text(firstName ?? '', 'First name', 100, true)} ${text(row.lastName ?? '', 'Last name', 100, true)}`.trim() || 'Name missing';
    const candidate = typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
    const email = candidate.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
    if (email && row.deleted !== true) emails.set(email, (emails.get(email) ?? 0) + 1);
    requireThat(Array.isArray(row.jobReferences), 'Toast employee job references are missing.', 502);
    const issues: string[] = [], assigned = new Set<string>();
    const references = row.jobReferences.map(value => { const ref = object(value), guid = text(ref.guid, 'Toast job reference', 100); requireThat(!assigned.has(guid), 'Toast returned a duplicate employee job reference.', 502); assigned.add(guid); const job = jobs.get(guid); if (!job) issues.push(`Job ${guid} was not in the job response; it may be archived.`); return job ?? { toastJobId: guid, title: 'Job needs review', archived: true }; });
    if (!email) issues.push('Login identity needs confirmation.');
    if (!references.length) issues.push('No jobs assigned.');
    if (name === 'Name missing') issues.push('Name needs confirmation.');
    return { toastEmployeeId, name, email, archived: row.deleted === true, jobs: references, issues };
  });
  for (const employee of employees) if (!employee.archived && employee.email && (emails.get(employee.email) ?? 0) > 1) employee.issues.push('Another active Toast employee has this email; do not merge automatically.');
  return { restaurantGuid, retrievedAt, employees, issues: employees.length ? [] : ['Toast returned no employees. Do not deactivate existing accounts automatically.'] };
}

export async function fetchToastRoster(config: { restaurantGuid: string; accessToken: string; host: string }, fetcher: typeof fetch = fetch): Promise<ToastRoster> {
  // Configuration comes from the server's reviewed connection, never a browser-supplied URL/token.
  requireThat(['https://ws-api.toasttab.com', 'https://ws-sandbox-api.toasttab.com'].includes(config.host), 'Toast server is not configured.', 503);
  requireThat(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(config.restaurantGuid) && config.accessToken.length > 0, 'Toast restaurant and access are required.', 503);
  const read = async (resource: 'employees' | 'jobs') => {
    const response = await fetcher(`${config.host}/labor/v1/${resource}`, { method: 'GET', redirect: 'manual', headers: { Authorization: `Bearer ${config.accessToken}`, 'Toast-Restaurant-External-ID': config.restaurantGuid, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) { await response.body?.cancel(); throw new AppError(response.status === 401 || response.status === 403 ? 503 : 502, response.status === 401 || response.status === 403 ? 'Toast access needs to be checked. The previous roster has not been replaced.' : 'Toast could not provide a complete roster. The previous roster has not been replaced.'); }
    return boundedJson(response.body, 4_000_000);
  };
  const results = await Promise.allSettled([read('employees'), read('jobs')]);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected'); if (failed) throw failed.reason;
  const values = results.map(r => (r as PromiseFulfilledResult<unknown>).value);
  return normalizeToastRoster(values[0], values[1], config.restaurantGuid);
}
