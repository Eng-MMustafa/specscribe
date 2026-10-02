/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SpecScribeRecorder } from '../src/standalone/SpecScribeRecorder';

const spec = {
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  servers: [{ url: 'http://localhost:3000' }],
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        summary: 'List users',
        responses: { '200': { description: 'OK' } },
      },
      post: {
        operationId: 'createUser',
        summary: 'Create user',
        responses: { '201': { description: 'Created' } },
      },
    },
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        summary: 'Get user',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
};

describe('SpecScribeRecorder', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specscribe-recorder-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records a matching request/response as a scenario step', () => {
    const recorder = new SpecScribeRecorder(tmpDir, spec);
    recorder.save(
      { method: 'GET', url: 'http://localhost:3000/users', headers: {}, body: '' },
      { status: 200, headers: { 'content-type': 'application/json' }, body: '[]' },
    );

    const files = fs.readdirSync(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/GET_users\.scenario\.json$/);

    const scenario = JSON.parse(fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8'));
    expect(scenario.steps).toHaveLength(1);
    expect(scenario.steps[0].request.method).toBe('GET');
    expect(scenario.steps[0].request.path).toBe('/users');
    expect(scenario.steps[0].expect.status).toBe(200);
    expect(scenario.steps[0].expect.matchesSpec).toBe(true);
  });

  it('normalises concrete IDs to the documented path template', () => {
    const recorder = new SpecScribeRecorder(tmpDir, spec);
    recorder.save(
      { method: 'GET', url: 'http://localhost:3000/users/42', headers: {}, body: '' },
      { status: 200, headers: {}, body: '{"id":42}' },
    );

    const files = fs.readdirSync(tmpDir);
    const scenario = JSON.parse(fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8'));
    expect(scenario.steps[0].request.path).toBe('/users/{id}');
  });

  it('ignores requests that do not match a documented route', () => {
    const recorder = new SpecScribeRecorder(tmpDir, spec);
    recorder.save(
      { method: 'GET', url: 'http://localhost:3000/unknown', headers: {}, body: '' },
      { status: 404, headers: {}, body: '' },
    );

    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });

  it('appends multiple steps to the same scenario file', () => {
    const recorder = new SpecScribeRecorder(tmpDir, spec);
    recorder.save(
      { method: 'GET', url: 'http://localhost:3000/users', headers: {}, body: '' },
      { status: 200, headers: {}, body: '[]' },
    );
    recorder.save(
      { method: 'GET', url: 'http://localhost:3000/users', headers: {}, body: '' },
      { status: 200, headers: {}, body: '[]' },
    );

    const files = fs.readdirSync(tmpDir);
    const scenario = JSON.parse(fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8'));
    expect(scenario.steps).toHaveLength(2);
  });

  it('parses JSON request bodies when present', () => {
    const recorder = new SpecScribeRecorder(tmpDir, spec);
    recorder.save(
      { method: 'POST', url: 'http://localhost:3000/users', headers: { 'content-type': 'application/json' }, body: '{"name":"Ada"}' },
      { status: 201, headers: {}, body: '{"id":1}' },
    );

    const files = fs.readdirSync(tmpDir);
    const scenario = JSON.parse(fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8'));
    expect(scenario.steps[0].request.body).toEqual({ name: 'Ada' });
  });
});
