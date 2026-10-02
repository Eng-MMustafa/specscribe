/**
 * Workspace helpers for the docs UI: the open-request tab list and
 * environment files (export / import, including Postman environments).
 * No DOM and no Lit, so it is unit tested under Node.
 */

export interface EnvironmentData {
  name: string;
  baseUrl: string;
  vars: Record<string, string>;
  allowCredentials: boolean;
}

export const ENV_FILE_FORMAT = 'specscribe-environments';
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_ENVS = 100;
const MAX_VARS = 500;
const MAX_VALUE = 10_000;

/** The file users download: versioned so future fields stay readable. */
export function toEnvironmentFile(envs: EnvironmentData[]): string {
  return JSON.stringify({
    format: ENV_FILE_FORMAT,
    version: 1,
    environments: envs.map(({ name, baseUrl, vars }) => ({ name, baseUrl, vars })),
  }, null, 2);
}

const str = (v: unknown, max = MAX_VALUE) => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v).slice(0, max) : '');

function cleanVars(entries: [unknown, unknown][]): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of entries.slice(0, MAX_VARS)) {
    const key = str(k, 200).trim();
    if (!key || UNSAFE_KEYS.has(key) || !/^[\w.-]+$/.test(key)) continue;
    vars[key] = str(v);
  }
  return vars;
}

/** Postman `{ name, values: [{ key, value, enabled }] }`; a `baseUrl`-style variable becomes the base URL. */
function fromPostman(env: { name?: unknown; values?: unknown }): EnvironmentData | null {
  if (!Array.isArray(env.values)) return null;
  const entries = (env.values as Record<string, unknown>[])
    .filter((v) => v && typeof v === 'object' && v.enabled !== false)
    .map((v) => [v.key, v.value] as [unknown, unknown]);
  const vars = cleanVars(entries);
  const baseKey = Object.keys(vars).find((k) => /^(base[_-]?url|baseUri|url|host)$/i.test(k));
  return { name: str(env.name, 100).trim() || 'Imported', baseUrl: baseKey ? vars[baseKey] : '', vars, allowCredentials: false };
}

/**
 * Reads our own file, a Postman environment (or an array of them), or a
 * bare `{ name, baseUrl, vars }`. Imported environments never send
 * credentials until the user turns that on — a shared file must not be able
 * to route your tokens to its own server.
 */
export function parseEnvironmentFile(text: string): EnvironmentData[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('Not a JSON file'); }
  const list: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { environments?: unknown }).environments)
      ? (data as { environments: unknown[] }).environments
      : [data];
  const out: EnvironmentData[] = [];
  for (const item of list.slice(0, MAX_ENVS)) {
    if (!item || typeof item !== 'object') continue;
    const env = item as Record<string, unknown>;
    const postman = fromPostman(env);
    if (postman) { out.push(postman); continue; }
    const name = str(env.name, 100).trim();
    if (!name) continue;
    const vars = env.vars && typeof env.vars === 'object' && !Array.isArray(env.vars)
      ? cleanVars(Object.entries(env.vars as Record<string, unknown>))
      : {};
    const baseUrl = str(env.baseUrl, 2000).trim();
    if (baseUrl && !/^https?:\/\//i.test(baseUrl) && !/^\{\{[\w.-]+\}\}/.test(baseUrl)) continue;
    out.push({ name, baseUrl, vars, allowCredentials: false });
  }
  if (!out.length) throw new Error('No environments found in this file');
  return out;
}

/** Imported environments replace same-named ones; everything else is kept, in order. */
export function mergeEnvironments(existing: EnvironmentData[], imported: EnvironmentData[]): EnvironmentData[] {
  const names = new Set(imported.map((e) => e.name));
  return [...existing.filter((e) => !names.has(e.name)), ...imported];
}

/* ---------------------------- request tabs ---------------------------- */

export interface TabRef {
  /** `rest:GET:/users`, `ws:Gateway/event`, `gql:Resolver/op`, `scenario:0`. */
  key: string;
  title: string;
  /** Short badge: the HTTP method, `WS`, `QUERY`, `FLOW`… */
  badge: string;
}

export const MAX_TABS = 12;

/**
 * Opens `tab` (or focuses it when already open). When the bar is full the
 * oldest tab that is not `keepKey` is dropped, like an editor's tab limit.
 */
export function openTab<T extends TabRef>(tabs: T[], tab: T, keepKey = '', limit = MAX_TABS): T[] {
  const existing = tabs.findIndex((t) => t.key === tab.key);
  if (existing !== -1) {
    const next = [...tabs];
    next[existing] = { ...next[existing], title: tab.title, badge: tab.badge };
    return next;
  }
  const next = [...tabs, tab];
  while (next.length > limit) {
    const drop = next.findIndex((t) => t.key !== keepKey && t.key !== tab.key);
    if (drop === -1) break;
    next.splice(drop, 1);
  }
  return next;
}

/** Closes `key`; when it was active, the neighbour to its right (else left) takes over. */
export function closeTab<T extends TabRef>(tabs: T[], key: string, activeKey: string): { tabs: T[]; active: string } {
  const index = tabs.findIndex((t) => t.key === key);
  if (index === -1) return { tabs, active: activeKey };
  const next = tabs.filter((t) => t.key !== key);
  if (key !== activeKey) return { tabs: next, active: activeKey };
  const neighbour = next[index] ?? next[index - 1];
  return { tabs: next, active: neighbour ? neighbour.key : '' };
}

/** Moves the active tab left/right (Ctrl+PageUp / Ctrl+PageDown), wrapping around. */
export function stepTab(tabs: TabRef[], activeKey: string, delta: number): string {
  if (!tabs.length) return '';
  const index = tabs.findIndex((t) => t.key === activeKey);
  const from = index === -1 ? 0 : index;
  return tabs[(from + delta + tabs.length) % tabs.length].key;
}
