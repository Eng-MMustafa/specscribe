/**
 * Request body modes for the docs UI: raw JSON, multipart form-data (with file
 * uploads) and URL-encoded forms. Pure helpers — no Lit, no DOM rendering.
 */
export type BodyMode = 'json' | 'form' | 'urlencoded' | 'none';

export interface BodySchema {
  type?: string;
  format?: string;
  properties?: Record<string, BodySchema>;
  required?: string[];
  items?: BodySchema;
  description?: string;
}

export interface FormRow {
  key: string;
  kind: 'text' | 'file';
  value: string;
  files: File[];
  enabled: boolean;
  multiple?: boolean;
  required?: boolean;
  description?: string;
}

export const CONTENT_TYPES: Record<BodyMode, string> = {
  json: 'application/json',
  form: 'multipart/form-data',
  urlencoded: 'application/x-www-form-urlencoded',
  none: '',
};

/** `format: binary` (or an array of them) is how OpenAPI documents an upload. */
export function isFileSchema(schema?: BodySchema): boolean {
  if (!schema) return false;
  if (schema.type === 'string' && (schema.format === 'binary' || schema.format === 'base64')) return true;
  return schema.type === 'array' && isFileSchema(schema.items);
}

/** Picks the body mode an operation documents, preferring JSON. */
export function bodyModeFor(contentTypes: string[], method: string): BodyMode {
  if (contentTypes.some(ct => ct.includes('json'))) return 'json';
  if (contentTypes.includes('multipart/form-data')) return 'form';
  if (contentTypes.includes('application/x-www-form-urlencoded')) return 'urlencoded';
  return ['POST', 'PUT', 'PATCH'].includes(method) ? 'json' : 'none';
}

/** One editable row per documented field, pre-filled with an example. */
export function formRowsFromSchema(
  schema: BodySchema | undefined,
  resolve: (s?: BodySchema) => BodySchema | undefined,
  example: (s: BodySchema | undefined, name: string) => unknown,
  allowFiles: boolean,
): FormRow[] {
  const root = resolve(schema);
  const required = new Set(root?.required ?? []);
  return Object.entries(root?.properties ?? {}).map(([key, raw]) => {
    const field = resolve(raw);
    const file = allowFiles && isFileSchema(field);
    const sample = file ? '' : example(field, key);
    return {
      key,
      kind: file ? 'file' : 'text',
      value: sample === undefined || sample === null ? '' : typeof sample === 'object' ? JSON.stringify(sample) : String(sample),
      files: [],
      enabled: true,
      multiple: file && field?.type === 'array',
      required: required.has(key),
      description: field?.description,
    };
  });
}

export interface BuiltBody {
  body?: BodyInit;
  /** Absent for multipart: the browser must set the boundary itself. */
  contentType?: string;
}

export function buildBody(mode: BodyMode, jsonText: string, rows: FormRow[], fill: (v: string) => string): BuiltBody {
  if (mode === 'none') return {};
  if (mode === 'json') {
    const text = fill(jsonText).trim();
    return text ? { body: text, contentType: CONTENT_TYPES.json } : {};
  }
  const active = rows.filter(r => r.enabled && r.key.trim());
  if (mode === 'urlencoded') {
    const params = new URLSearchParams();
    for (const row of active) params.append(row.key.trim(), fill(row.value));
    return { body: params.toString(), contentType: CONTENT_TYPES.urlencoded };
  }
  const form = new FormData();
  for (const row of active) {
    if (row.kind === 'file') for (const file of row.files) form.append(row.key.trim(), file, file.name);
    else form.append(row.key.trim(), fill(row.value));
  }
  return { body: form };
}

const quote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

/** Body portion of a cURL command. */
export function curlBodyArgs(mode: BodyMode, jsonText: string, rows: FormRow[], fill: (v: string) => string): string[] {
  if (mode === 'none') return [];
  if (mode === 'json') {
    const text = fill(jsonText).trim();
    return text ? [`-d ${quote(text.replace(/\n\s*/g, ' '))}`] : [];
  }
  const active = rows.filter(r => r.enabled && r.key.trim());
  if (mode === 'urlencoded') return active.map(r => `--data-urlencode ${quote(`${r.key}=${fill(r.value)}`)}`);
  return active.flatMap(r => r.kind === 'file'
    ? (r.files.length ? r.files : [{ name: 'path/to/file' } as File]).map(f => `-F ${quote(`${r.key}=@${f.name}`)}`)
    : [`-F ${quote(`${r.key}=${fill(r.value)}`)}`]);
}

/** Lines that build the body in JavaScript, plus the expression to send. */
export function jsBody(mode: BodyMode, jsonText: string, rows: FormRow[], fill: (v: string) => string, axios: boolean):
  { setup: string[]; expr?: string } {
  if (mode === 'none') return { setup: [] };
  if (mode === 'json') {
    const text = fill(jsonText).trim();
    if (!text) return { setup: [] };
    return { setup: [], expr: axios ? text.replace(/\n/g, '\n  ') : `JSON.stringify(${text.replace(/\n/g, '\n  ')})` };
  }
  const active = rows.filter(r => r.enabled && r.key.trim());
  if (mode === 'urlencoded') {
    const pairs = Object.fromEntries(active.map(r => [r.key, fill(r.value)]));
    return { setup: [], expr: `new URLSearchParams(${JSON.stringify(pairs)})` };
  }
  const setup = ['const form = new FormData();'];
  for (const r of active) {
    setup.push(r.kind === 'file'
      ? `form.append(${JSON.stringify(r.key)}, fileInput.files[0]); // ${r.files[0]?.name ?? 'choose a file'}`
      : `form.append(${JSON.stringify(r.key)}, ${JSON.stringify(fill(r.value))});`);
  }
  return { setup, expr: 'form' };
}
