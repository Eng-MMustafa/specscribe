/**
 * The browser-side scenario runner (src/ui/lit/scenarios.ts) and the
 * document the docs servers serve at `/docs-scenarios-json`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  containsSubset, extractPath, fillDeep, isScenario, parseScenarios, runScenario, scenarioFileName,
  schemaFailures, toScenarioFile, type RunHooks, type Scenario, type StepRun,
} from '../src/ui/lit/scenarios';
import { buildScenarioDocument } from '../src/runner/ScenarioDocument';

const identity = (s?: any) => s;

function hooks(responses: Record<string, { status: number; body?: unknown }>, overrides: Partial<RunHooks> = {}) {
  const calls: { method: string; path: string; headers: Record<string, string>; body?: string }[] = [];
  const runs: StepRun[] = [];
  const h: RunHooks = {
    send: async (method, p, headers, body) => {
      calls.push({ method, path: p, headers, body });
      const r = responses[`${method} ${p}`] ?? { status: 404, body: { message: 'nope' } };
      return { status: r.status, text: r.body === undefined ? '' : JSON.stringify(r.body), url: `http://api${p}` };
    },
    responseSchema: () => undefined,
    resolve: identity,
    onStep: (i, run) => { runs[i] = run; },
    ...overrides,
  };
  return { h, calls, runs };
}

describe('UI scenario runner', () => {
  const flow: Scenario = {
    name: 'Users flow',
    vars: { suffix: 'x' },
    steps: [
      { name: 'login', request: { method: 'post', path: '/auth/login', body: { user: 'demo-{{suffix}}' } }, capture: { token: '$.access_token' } },
      { name: 'create', request: { method: 'POST', path: '/users', headers: { Authorization: 'Bearer {{token}}' }, body: { name: 'Ada' } }, expect: { status: 201, bodyContains: { name: 'Ada' } }, capture: { userId: '$.id' } },
      { name: 'read', request: { method: 'GET', path: '/users/{{userId}}' }, expect: { matchesSpec: true } },
    ],
  };

  it('threads captured values into later steps and reports each step', async () => {
    const { h, calls, runs } = hooks({
      'POST /auth/login': { status: 200, body: { access_token: 'tok-1' } },
      'POST /users': { status: 201, body: { id: 7, name: 'Ada' } },
      'GET /users/7': { status: 200, body: { id: 7, name: 'Ada' } },
    }, { responseSchema: () => ({ type: 'object', required: ['id', 'name'], properties: { id: { type: 'integer' }, name: { type: 'string' } } }) });

    const vars = await runScenario(flow, { base: 'keep' }, h, true);

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /auth/login', 'POST /users', 'GET /users/7']);
    expect(JSON.parse(calls[0].body!)).toEqual({ user: 'demo-x' });
    expect(calls[1].headers).toMatchObject({ Authorization: 'Bearer tok-1', 'Content-Type': 'application/json' });
    expect(runs.map((r) => r.state)).toEqual(['pass', 'pass', 'pass']);
    expect(runs[1].captured).toEqual({ userId: '7' });
    expect(vars).toMatchObject({ base: 'keep', suffix: 'x', token: 'tok-1', userId: '7' });
  });

  it('fails with readable reasons and stops at the first failure when asked', async () => {
    const { h, runs } = hooks({
      'POST /auth/login': { status: 200, body: {} },
      'POST /users': { status: 400, body: { name: 'Bob' } },
    });
    await runScenario(flow, {}, h, true);
    expect(runs[0].state).toBe('fail');
    expect(runs[0].failures).toEqual(['capture token: nothing at $.access_token']);
    expect(runs.slice(1).map((r) => r.state)).toEqual(['skipped', 'skipped']);
  });

  it('keeps going without stop-on-failure and reports status, subset and spec mismatches', async () => {
    const { h, runs } = hooks({
      'POST /auth/login': { status: 200, body: { access_token: 't' } },
      'POST /users': { status: 400, body: { name: 'Bob' } },
      'GET /users/{{userId}}': { status: 200, body: { id: 'seven' } },
    }, { responseSchema: () => ({ type: 'object', required: ['id', 'name'], properties: { id: { type: 'integer' } } }) });
    await runScenario(flow, {}, h, false);
    expect(runs[1].failures).toEqual(expect.arrayContaining([
      'status: expected 201, got 400',
      'name: expected "Ada", got "Bob"',
    ]));
    expect(runs[2].failures).toEqual(expect.arrayContaining(['id: expected integer, got string', 'name: required field missing']));
  });

  it('skips the remaining steps once the user presses Stop', async () => {
    let stop = false;
    const { h, calls, runs } = hooks({ 'POST /auth/login': { status: 200, body: { access_token: 't' } } }, {
      cancelled: () => stop,
      onStep: (i, run) => { runs[i] = run; if (run.state !== 'running') stop = true; },
    });
    await runScenario(flow, {}, h, false);
    expect(calls).toHaveLength(1);
    expect(runs.map((r) => r.state)).toEqual(['pass', 'skipped', 'skipped']);
  });

  it('turns network errors into a failed step instead of crashing the run', async () => {
    const { h, runs } = hooks({}, { send: async () => { throw new Error('API unreachable'); } });
    await runScenario({ name: 's', steps: [flow.steps[2]] }, {}, h, false);
    expect(runs[0]).toMatchObject({ state: 'fail', failures: ['API unreachable'] });
  });

  it('reports when matchesSpec has no documented schema', async () => {
    const { h, runs } = hooks({ 'GET /users/{{userId}}': { status: 200, body: {} } });
    await runScenario({ name: 's', steps: [flow.steps[2]] }, {}, h, false);
    expect(runs[0].failures).toEqual(['spec: no documented schema for this status']);
  });

  it('parses single scenarios, arrays and { scenarios } documents, rejecting junk', () => {
    expect(parseScenarios(JSON.stringify(flow))).toHaveLength(1);
    expect(parseScenarios(JSON.stringify([flow, flow]))).toHaveLength(2);
    expect(parseScenarios(JSON.stringify({ scenarios: [flow, { nope: 1 }] }))).toHaveLength(1);
    expect(() => parseScenarios('{"name":"x"}')).toThrow(/No valid scenario/);
    expect(isScenario({ name: 'x', steps: [{ request: { method: 'GET' } }] })).toBe(false);
  });

  it('exports exactly the specscribe test file format', () => {
    const file = JSON.parse(toScenarioFile({ ...flow, source: 'imported' }));
    expect(file).not.toHaveProperty('source');
    expect(file.steps).toHaveLength(3);
    expect(scenarioFileName(flow)).toBe('users.scenario.json');
    expect(scenarioFileName({ name: '!!!', steps: [] })).toBe('scenario.scenario.json');
  });

  it('ignores prototype keys in paths, bodies and subsets', () => {
    expect(extractPath({ a: [{ b: 1 }] }, '$.a[0].b')).toBe(1);
    expect(extractPath({}, '$.__proto__.polluted')).toBeUndefined();
    expect(fillDeep(JSON.parse('{"__proto__":{"x":1},"a":"{{v}}"}'), { v: 'ok' })).toEqual({ a: 'ok' });
    expect(containsSubset({ a: [1, 2] }, { a: [1] })).toEqual([]);
    expect(containsSubset({ a: 1 }, { a: [1] })).toEqual(['a: expected an array']);
    expect(containsSubset(null, { a: 1 })).toEqual(['(root): expected an object']);
  });

  it('checks nullable fields and array items against the schema', () => {
    const schema = { type: 'array', items: { type: 'object', properties: { n: { type: 'number', nullable: true } } } };
    expect(schemaFailures(schema, [{ n: null }, { n: 2 }], identity)).toEqual([]);
    expect(schemaFailures(schema, [{ n: 'x' }], identity)).toEqual(['[0].n: expected number, got string']);
    expect(schemaFailures({ type: 'string' }, null, identity)).toEqual(['(root): unexpected null']);
  });
});

describe('buildScenarioDocument', () => {
  it('serves recorded scenarios first, then generated ones, skipping broken files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specscribe-scn-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.scenario.json'), JSON.stringify({ name: 'Recorded', steps: [] }));
      fs.writeFileSync(path.join(dir, 'b.scenario.json'), '{ broken');
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
      const spec = {
        openapi: '3.0.0', info: { title: 't', version: '1' }, servers: [{ url: 'http://x' }],
        paths: { '/items': { get: { tags: ['Items'], responses: { 200: { description: 'OK' } } } } },
      };
      const doc = buildScenarioDocument(spec, dir);
      expect(doc.scenarios.map((s) => `${s.source}:${s.name}`)).toEqual(['recorded:Recorded', 'generated:Items flow']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('copes with an empty or invalid spec', () => {
    expect(buildScenarioDocument({}).scenarios).toEqual([]);
    expect(buildScenarioDocument(null).scenarios).toEqual([]);
  });
});
