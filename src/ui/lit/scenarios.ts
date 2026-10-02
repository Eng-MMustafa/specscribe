/**
 * Browser-side scenario runner. Uses the exact file format of
 * `specscribe test` (`*.scenario.json`), so a flow built or recorded in the
 * docs UI runs unchanged in CI. Pure logic — rendering lives in main.ts.
 */
export interface ScenarioStep {
  name: string;
  request: { method: string; path: string; headers?: Record<string, string>; body?: unknown };
  expect?: { status?: number | number[]; bodyContains?: unknown; matchesSpec?: boolean };
  capture?: Record<string, string>;
}

export interface Scenario {
  name: string;
  baseUrl?: string;
  vars?: Record<string, string>;
  steps: ScenarioStep[];
  /** UI-only: where the scenario came from. Stripped on export. */
  source?: 'generated' | 'recorded' | 'imported';
}

export type StepState = 'pending' | 'running' | 'pass' | 'fail' | 'skipped';

export interface StepRun {
  state: StepState;
  status?: number;
  ms?: number;
  url?: string;
  failures: string[];
  request?: string;
  response?: string;
  captured?: Record<string, string>;
}

export interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
  nullable?: boolean;
}

export interface RunHooks {
  /** Performs the HTTP call for a step whose path/headers/body are already filled. */
  send(method: string, path: string, headers: Record<string, string>, body?: string):
    Promise<{ status: number; text: string; url: string }>;
  /** Documented response schema for `matchesSpec`, if any. */
  responseSchema(method: string, path: string, status: number): SchemaNode | undefined;
  resolve(schema?: SchemaNode): SchemaNode | undefined;
  onStep(index: number, run: StepRun): void;
  /** True once the user pressed Stop: remaining steps are skipped. */
  cancelled?(): boolean;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isScenario(value: unknown): value is Scenario {
  const v = value as Scenario;
  return !!v && typeof v === 'object' && typeof v.name === 'string' && Array.isArray(v.steps)
    && v.steps.every(s => !!s && typeof s === 'object' && !!s.request
      && typeof s.request.method === 'string' && typeof s.request.path === 'string');
}

/** Accepts a scenario, an array of them, or `{ scenarios: [...] }`. */
export function parseScenarios(text: string): Scenario[] {
  const parsed: unknown = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { scenarios?: unknown[] }).scenarios)
      ? (parsed as { scenarios: unknown[] }).scenarios
      : [parsed];
  const valid = list.filter(isScenario);
  if (!valid.length) throw new Error('No valid scenario found (expected { name, steps: [{ request: { method, path } }] }).');
  return valid;
}

export function fillVars(text: string, vars: Record<string, string>): string {
  return String(text).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) => (vars[key] !== undefined ? vars[key] : match));
}

export function fillDeep(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') return fillVars(value, vars);
  if (Array.isArray(value)) return value.map(item => fillDeep(item, vars));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (!DANGEROUS_KEYS.has(key)) out[key] = fillDeep(child, vars);
    }
    return out;
  }
  return value;
}

export function extractPath(payload: unknown, path: string): unknown {
  const trimmed = path.replace(/^\$\.?/, '');
  if (!trimmed) return payload;
  let node: unknown = payload;
  for (const segment of trimmed.split('.')) {
    const match = /^([^[\]]*)((?:\[\d+\])*)$/.exec(segment);
    if (!match || node === null || node === undefined) return undefined;
    if (match[1]) {
      if (DANGEROUS_KEYS.has(match[1])) return undefined;
      node = (node as Record<string, unknown>)[match[1]];
    }
    for (const index of match[2].match(/\d+/g) ?? []) {
      if (node === null || node === undefined) return undefined;
      node = (node as unknown[])[Number(index)];
    }
  }
  return node;
}

/** Every field in `expected` must be present in `actual` with an equal value. */
export function containsSubset(actual: unknown, expected: unknown, at = ''): string[] {
  const where = at || '(root)';
  if (expected === null || typeof expected !== 'object') {
    return actual === expected ? [] : [`${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${where}: expected an array`];
    return expected.flatMap((item, i) => containsSubset(actual[i], item, `${at}[${i}]`));
  }
  if (actual === null || typeof actual !== 'object') return [`${where}: expected an object`];
  return Object.keys(expected as Record<string, unknown>)
    .filter(key => !DANGEROUS_KEYS.has(key))
    .flatMap(key => containsSubset(
      (actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], at ? `${at}.${key}` : key));
}

/** Light structural check: types and required properties, a few levels deep. */
export function schemaFailures(
  schema: SchemaNode | undefined, value: unknown, resolve: (s?: SchemaNode) => SchemaNode | undefined, at = '', depth = 0,
): string[] {
  const s = resolve(schema);
  if (!s || depth > 4) return [];
  const where = at || '(root)';
  if (value === null) return s.nullable ? [] : s.type ? [`${where}: unexpected null`] : [];
  const actual = Array.isArray(value) ? 'array' : typeof value;
  const ok = !s.type || s.type === actual || (s.type === 'integer' && Number.isInteger(value))
    || (s.type === 'number' && actual === 'number') || (s.type === 'object' && actual === 'object' && !Array.isArray(value));
  if (!ok) return [`${where}: expected ${s.type}, got ${actual}`];
  if (s.type === 'array' && Array.isArray(value)) {
    return value.slice(0, 3).flatMap((item, i) => schemaFailures(s.items, item, resolve, `${at}[${i}]`, depth + 1));
  }
  if (actual === 'object' && s.properties) {
    const obj = value as Record<string, unknown>;
    const missing = (s.required ?? []).filter(key => !(key in obj)).map(key => `${at ? `${at}.` : ''}${key}: required field missing`);
    const nested = Object.entries(s.properties)
      .filter(([key]) => key in obj)
      .flatMap(([key, child]) => schemaFailures(child, obj[key], resolve, at ? `${at}.${key}` : key, depth + 1));
    return [...missing, ...nested];
  }
  return [];
}

function statusFailures(expected: number | number[] | undefined, status: number): string[] {
  if (expected === undefined) return status >= 200 && status < 300 ? [] : [`status: expected 2xx, got ${status}`];
  const accepted = Array.isArray(expected) ? expected : [expected];
  return accepted.includes(status) ? [] : [`status: expected ${accepted.join(' or ')}, got ${status}`];
}

/**
 * Runs every step in order, threading captured variables into later steps.
 * Returns the final variable map (initial + captured).
 */
export async function runScenario(
  scenario: Scenario, initialVars: Record<string, string>, hooks: RunHooks, stopOnFail: boolean,
): Promise<Record<string, string>> {
  const vars: Record<string, string> = { ...initialVars };
  for (const [key, value] of Object.entries(scenario.vars ?? {})) if (!DANGEROUS_KEYS.has(key)) vars[key] = value;
  let stopped = false;

  for (const [index, step] of scenario.steps.entries()) {
    if (stopped || hooks.cancelled?.()) { hooks.onStep(index, { state: 'skipped', failures: [] }); continue; }
    hooks.onStep(index, { state: 'running', failures: [] });
    const started = performance.now();
    const failures: string[] = [];
    const run: StepRun = { state: 'pass', failures };
    try {
      const path = fillVars(step.request.path, vars);
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(step.request.headers ?? {})) {
        if (!DANGEROUS_KEYS.has(key)) headers[key] = fillVars(value, vars);
      }
      let body: string | undefined;
      if (step.request.body !== undefined) {
        body = JSON.stringify(fillDeep(step.request.body, vars), null, 2);
        if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
      }
      run.request = body;
      const response = await hooks.send(step.request.method.toUpperCase(), path, headers, body);
      run.status = response.status;
      run.url = response.url;
      let json: unknown;
      try { json = response.text ? JSON.parse(response.text) : undefined; } catch { json = undefined; }
      run.response = json !== undefined ? JSON.stringify(json, null, 2) : response.text;

      failures.push(...statusFailures(step.expect?.status, response.status));
      if (step.expect?.bodyContains !== undefined) failures.push(...containsSubset(json, step.expect.bodyContains));
      if (step.expect?.matchesSpec) {
        const schema = hooks.responseSchema(step.request.method, path, response.status);
        failures.push(...(schema ? schemaFailures(schema, json, hooks.resolve) : ['spec: no documented schema for this status']));
      }
      for (const [name, jsonPath] of Object.entries(step.capture ?? {})) {
        if (DANGEROUS_KEYS.has(name)) continue;
        const value = extractPath(json, jsonPath);
        if (value === undefined || value === null) {
          failures.push(`capture ${name}: nothing at ${jsonPath}`);
        } else {
          vars[name] = typeof value === 'string' ? value : JSON.stringify(value);
          run.captured = { ...(run.captured ?? {}), [name]: vars[name] };
        }
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    run.ms = Math.round(performance.now() - started);
    run.state = failures.length ? 'fail' : 'pass';
    hooks.onStep(index, run);
    if (run.state === 'fail' && stopOnFail) stopped = true;
  }
  return vars;
}

/** Export shape: exactly what `specscribe test` reads. */
export function toScenarioFile(scenario: Scenario): string {
  const { source: _source, ...rest } = scenario;
  return JSON.stringify(rest, null, 2);
}

export function scenarioFileName(scenario: Scenario): string {
  const slug = scenario.name.replace(/\s+flow$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scenario';
  return `${slug}.scenario.json`;
}
