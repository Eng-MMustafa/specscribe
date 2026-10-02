/**
 * Request body modes of the docs UI (src/ui/lit/request-body.ts): JSON,
 * multipart form-data with files, URL-encoded forms, and their snippets.
 */
import {
  bodyModeFor, buildBody, curlBodyArgs, formRowsFromSchema, isFileSchema, jsBody, type FormRow,
} from '../src/ui/lit/request-body';

const identity = (s?: any) => s;
const fill = (v: string) => v.replace('{{name}}', 'Ada');
const example = (s: any) => (s?.type === 'integer' ? 1 : s?.type === 'object' ? { a: 1 } : 'text');

describe('UI request bodies', () => {
  it('picks the documented body mode, preferring JSON', () => {
    expect(bodyModeFor(['application/json', 'multipart/form-data'], 'POST')).toBe('json');
    expect(bodyModeFor(['application/vnd.api+json'], 'POST')).toBe('json');
    expect(bodyModeFor(['multipart/form-data'], 'POST')).toBe('form');
    expect(bodyModeFor(['application/x-www-form-urlencoded'], 'PUT')).toBe('urlencoded');
    expect(bodyModeFor([], 'PATCH')).toBe('json');
    expect(bodyModeFor([], 'GET')).toBe('none');
  });

  it('recognises documented uploads', () => {
    expect(isFileSchema({ type: 'string', format: 'binary' })).toBe(true);
    expect(isFileSchema({ type: 'array', items: { type: 'string', format: 'base64' } })).toBe(true);
    expect(isFileSchema({ type: 'string' })).toBe(false);
    expect(isFileSchema(undefined)).toBe(false);
  });

  it('builds one row per field with examples, file pickers and required flags', () => {
    const schema = {
      type: 'object',
      required: ['avatar'],
      properties: {
        avatar: { type: 'string', format: 'binary', description: 'PNG or JPEG' },
        photos: { type: 'array', items: { type: 'string', format: 'binary' } },
        age: { type: 'integer' },
        meta: { type: 'object' },
      },
    };
    const rows = formRowsFromSchema(schema, identity, example, true);
    expect(rows.map((r) => [r.key, r.kind, r.value, !!r.multiple, !!r.required])).toEqual([
      ['avatar', 'file', '', false, true],
      ['photos', 'file', '', true, false],
      ['age', 'text', '1', false, false],
      ['meta', 'text', '{"a":1}', false, false],
    ]);
    expect(rows[0].description).toBe('PNG or JPEG');
    // URL-encoded forms cannot carry files: binary fields become text.
    expect(formRowsFromSchema(schema, identity, example, false)[0].kind).toBe('text');
    expect(formRowsFromSchema(undefined, identity, example, true)).toEqual([]);
  });

  // Node 18 has File only on the buffer module; 20+ has it globally.
  const FileCtor: typeof File = (globalThis as any).File ?? require('buffer').File;
  const file = new FileCtor([new Uint8Array(4)], 'cat.png', { type: 'image/png' });
  const rows: FormRow[] = [
    { key: 'name', kind: 'text', value: '{{name}}', files: [], enabled: true },
    { key: 'avatar', kind: 'file', value: '', files: [file], enabled: true },
    { key: 'skip', kind: 'text', value: 'no', files: [], enabled: false },
    { key: ' ', kind: 'text', value: 'blank key', files: [], enabled: true },
  ];

  it('sends JSON with its content type, and nothing for empty bodies', () => {
    expect(buildBody('json', '{ "name": "{{name}}" }', [], fill)).toEqual({ body: '{ "name": "Ada" }', contentType: 'application/json' });
    expect(buildBody('json', '   ', [], fill)).toEqual({});
    expect(buildBody('none', '{}', rows, fill)).toEqual({});
  });

  it('sends multipart without a content type so the browser sets the boundary', () => {
    const { body, contentType } = buildBody('form', '', rows, fill);
    expect(contentType).toBeUndefined();
    const form = body as FormData;
    expect(form.get('name')).toBe('Ada');
    expect((form.get('avatar') as File).name).toBe('cat.png');
    expect(form.has('skip')).toBe(false);
  });

  it('URL-encodes form fields', () => {
    expect(buildBody('urlencoded', '', rows.filter((r) => r.kind === 'text'), fill))
      .toEqual({ body: 'name=Ada', contentType: 'application/x-www-form-urlencoded' });
  });

  it('writes matching cURL arguments', () => {
    expect(curlBodyArgs('json', '{\n  "a": "it\'s"\n}', [], fill)).toEqual([`-d '{ "a": "it'\\''s" }'`]);
    expect(curlBodyArgs('form', '', rows, fill)).toEqual([`-F 'name=Ada'`, `-F 'avatar=@cat.png'`]);
    expect(curlBodyArgs('form', '', [{ ...rows[1], files: [] }], fill)).toEqual([`-F 'avatar=@path/to/file'`]);
    expect(curlBodyArgs('urlencoded', '', [rows[0]], fill)).toEqual([`--data-urlencode 'name=Ada'`]);
    expect(curlBodyArgs('none', '', rows, fill)).toEqual([]);
  });

  it('writes matching fetch / axios bodies', () => {
    expect(jsBody('json', '{"a":1}', [], fill, false)).toEqual({ setup: [], expr: 'JSON.stringify({"a":1})' });
    expect(jsBody('json', '{"a":1}', [], fill, true)).toEqual({ setup: [], expr: '{"a":1}' });
    expect(jsBody('urlencoded', '', [rows[0]], fill, false).expr).toBe('new URLSearchParams({"name":"Ada"})');
    const multipart = jsBody('form', '', rows, fill, false);
    expect(multipart.expr).toBe('form');
    expect(multipart.setup).toEqual([
      'const form = new FormData();',
      'form.append("name", "Ada");',
      'form.append("avatar", fileInput.files[0]); // cat.png',
    ]);
    expect(jsBody('none', '', rows, fill, false)).toEqual({ setup: [] });
    expect(jsBody('json', '', [], fill, false)).toEqual({ setup: [] });
  });
});
