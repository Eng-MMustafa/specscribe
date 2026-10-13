/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import * as fs from 'fs';
import * as path from 'path';
import { resolveExistingPathWithinRoot } from '../utils/PathSecurity';
import { balancedSlice, objectEntries, readExpression, splitTopLevel } from './ExpressLexical';

export type SymbolKind = 'value' | 'interface' | 'type' | 'class' | 'enum';

export interface SymbolDefinition {
  name: string;
  kind: SymbolKind;
  /** Expression text for values/types, body text (inside braces) for interface/class/enum. */
  text: string;
  /** `interface X extends A, B` parents. */
  extends?: string[];
  filePath: string;
}

interface FileInfo {
  text: string;
  /** local name → { source file, exported name } */
  imports: Map<string, { file: string; name: string }>;
  /** namespace local → source file (import * as ns) */
  namespaces: Map<string, string>;
  /** `export { X } from './y'` re-exports: exported name → { file, name } */
  reexports: Map<string, { file: string; name: string }>;
  reexportAll: string[];
}

/**
 * Resolves identifiers (schemas, DTO interfaces, enums) across an Express
 * project by following ES/CommonJS imports. Files are read lazily and cached.
 */
export class ExpressSymbolRegistry {
  private files = new Map<string, FileInfo>();

  constructor(private readonly rootPath: string) {}

  /** Looks `name` (may be dotted: `schemas.CreateUser`) up starting in `fromFile`. */
  resolve(name: string, fromFile: string, depth = 0): SymbolDefinition | null {
    if (depth > 6 || !name) return null;
    const info = this.load(fromFile);
    if (!info) return null;

    const dot = name.indexOf('.');
    if (dot !== -1) {
      const ns = name.slice(0, dot);
      const rest = name.slice(dot + 1);
      const nsFile = info.namespaces.get(ns);
      if (nsFile) return this.resolveExported(rest, nsFile, depth + 1);
      // `Schemas.CreateUser` where Schemas is a plain object literal in scope.
      const container = this.resolve(ns, fromFile, depth + 1);
      if (container && container.kind === 'value') {
        const inner = this.memberOfObjectLiteral(container.text, rest);
        if (inner) return { name: rest, kind: 'value', text: inner, filePath: container.filePath };
      }
      return null;
    }

    const local = this.findInFile(name, info.text, fromFile);
    if (local) return local;

    const imported = info.imports.get(name);
    if (imported) return this.resolveExported(imported.name, imported.file, depth + 1);
    return null;
  }

  /**
   * The compile-time string value of an expression written in `fromFile`,
   * following imports (ES and CommonJS) across the project:
   * `'x'`, `` `/${NS}` ``, `'chat:' + 'send'`, `EVENTS.JOIN`, `EVENTS['JOIN']`,
   * `Object.freeze({ … })` / `as const` objects, nested members and TS enums.
   * `undefined` when the value only exists at runtime.
   */
  resolveString(expression: string, fromFile: string, depth = 0): string | undefined {
    if (depth > 10 || !expression) return undefined;
    let expr = expression.trim().replace(/\s+as\s+const$/, '').trim();
    while (expr.startsWith('(') && balancedSlice(expr, 0).length === expr.length) expr = expr.slice(1, -1).trim();
    if (!expr) return undefined;

    const quoted = /^(['"])((?:\\.|(?!\1)[^\\])*)\1$/.exec(expr);
    if (quoted) return quoted[2].replace(/\\(.)/g, '$1');
    if (/^-?\d+(?:\.\d+)?$/.test(expr)) return expr;
    if (expr.startsWith('`') && expr.endsWith('`') && expr.length >= 2) {
      const body = expr.slice(1, -1);
      let out = '';
      for (let i = 0; i < body.length; i++) {
        if (body[i] === '\\') { out += body[i + 1] ?? ''; i++; continue; }
        if (body[i] === '$' && body[i + 1] === '{') {
          const block = balancedSlice(body, i + 1);
          const value = this.resolveString(block.slice(1, -1), fromFile, depth + 1);
          if (value === undefined) return undefined;
          out += value;
          i += block.length;
          continue;
        }
        out += body[i];
      }
      return out;
    }

    const parts = splitTopLevel(expr, '+');
    if (parts.length > 1) {
      let out = '';
      for (const part of parts) {
        const value = this.resolveString(part, fromFile, depth + 1);
        if (value === undefined) return undefined;
        out += value;
      }
      return out;
    }

    // A.B.C / A['B'] — a constant, an object member or an enum member.
    const chain = /^([A-Za-z_$][\w$]*)((?:\s*\.\s*[A-Za-z_$][\w$]*|\s*\[\s*(['"])[^'"]+\3\s*\])*)$/.exec(expr);
    if (!chain) return undefined;
    const members = [...chain[2].matchAll(/\.\s*([A-Za-z_$][\w$]*)|\[\s*['"]([^'"]+)['"]\s*\]/g)].map((m) => m[1] ?? m[2]);
    const head = this.resolve(chain[1], fromFile);
    if (!head) return undefined;
    let text = head.text;
    let file = head.filePath;
    let kind = head.kind;
    for (const member of members) {
      if (kind === 'enum') {
        const entry = new RegExp(`(?:^|,|\\n)\\s*['"]?${member.replace(/[$]/g, '\\$')}['"]?\\s*=\\s*([^,\\n]+)`).exec(text);
        return entry ? this.resolveString(entry[1], file, depth + 1) : undefined;
      }
      if (kind !== 'value') return undefined;
      const object = this.objectLiteralOf(text);
      const next = object ? this.memberOfObjectLiteral(object, member) : null;
      if (next === null) {
        // `{ X }` / `X: Y` pointing at another constant: resolve that first.
        const nested = /^[A-Za-z_$][\w$.]*$/.test(text.trim()) ? this.resolve(text.trim(), file) : null;
        if (!nested) return undefined;
        const object2 = this.objectLiteralOf(nested.text);
        const viaNested = object2 ? this.memberOfObjectLiteral(object2, member) : null;
        if (viaNested === null) return undefined;
        text = viaNested;
        file = nested.filePath;
        kind = 'value';
        continue;
      }
      if (next === member) {
        // Shorthand `{ member }`: the local declaration of that name.
        const local = this.resolve(member, file);
        if (!local) return undefined;
        text = local.text;
        file = local.filePath;
        kind = local.kind;
        continue;
      }
      text = next;
    }
    return kind === 'value' ? this.resolveString(text, file, depth + 1) : undefined;
  }

  /** `{ … }` behind `Object.freeze({ … })`, `({ … })` and `{ … } as const`. */
  private objectLiteralOf(text: string): string | null {
    let t = text.trim().replace(/\s+as\s+const$/, '').trim();
    const frozen = /^Object\s*\.\s*freeze\s*\(/.exec(t);
    if (frozen) t = t.slice(frozen[0].length - 1).trim();
    while (t.startsWith('(') && balancedSlice(t, 0).length === t.length) t = t.slice(1, -1).trim();
    return t.startsWith('{') ? t : null;
  }

  private resolveExported(name: string, file: string, depth: number): SymbolDefinition | null {
    if (depth > 6) return null;
    const info = this.load(file);
    if (!info) return null;
    const local = this.findInFile(name === 'default' ? this.defaultExportName(info.text) || name : name, info.text, file);
    if (local) return local;
    const re = info.reexports.get(name);
    if (re) return this.resolveExported(re.name, re.file, depth + 1);
    for (const barrel of info.reexportAll) {
      const found = this.resolveExported(name, barrel, depth + 1);
      if (found) return found;
    }
    const imported = info.imports.get(name);
    if (imported) return this.resolveExported(imported.name, imported.file, depth + 1);
    return null;
  }

  private findInFile(name: string, text: string, filePath: string): SymbolDefinition | null {
    const esc = name.replace(/[$]/g, '\\$');

    const iface = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?interface\\s+${esc}\\b(?:\\s*<[^{]*>)?(?:\\s+extends\\s+([^{]+))?\\s*\\{`).exec(text);
    if (iface) {
      const open = text.indexOf('{', iface.index + iface[0].length - 1);
      const block = balancedSlice(text, open);
      const parents = iface[1] ? iface[1].split(',').map((s) => s.trim().replace(/<.*$/, '')).filter(Boolean) : undefined;
      return { name, kind: 'interface', text: block.slice(1, -1), extends: parents, filePath };
    }

    const typeAlias = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?type\\s+${esc}\\b(?:\\s*<[^=]*>)?\\s*=`).exec(text);
    if (typeAlias) {
      const start = typeAlias.index + typeAlias[0].length;
      return { name, kind: 'type', text: readExpression(text, start).trim(), filePath };
    }

    const enumDecl = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:const\\s+)?enum\\s+${esc}\\s*\\{`).exec(text);
    if (enumDecl) {
      const open = text.indexOf('{', enumDecl.index + enumDecl[0].length - 1);
      return { name, kind: 'enum', text: balancedSlice(text, open).slice(1, -1), filePath };
    }

    const classDecl = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+${esc}\\b[^{]*\\{`).exec(text);
    if (classDecl) {
      const open = text.indexOf('{', classDecl.index + classDecl[0].length - 1);
      const parents = /extends\s+([A-Za-z_$][\w$.]*)/.exec(classDecl[0]);
      return { name, kind: 'class', text: balancedSlice(text, open).slice(1, -1), extends: parents ? [parents[1]] : undefined, filePath };
    }

    const value = this.findLocalValue(name, text, filePath, true);
    if (value) return value;

    // CommonJS: exports.X = ... / module.exports.X = ...
    const cjs = new RegExp(`(?:module\\.)?exports\\.${esc}\\s*=(?!=)`).exec(text);
    if (cjs) {
      const start = cjs.index + cjs[0].length;
      return { name, kind: 'value', text: readExpression(text, start).trim(), filePath };
    }

    // module.exports = { X, Y: ... }
    const cjsObject = /module\.exports\s*=\s*\{/.exec(text);
    if (cjsObject) {
      const open = text.indexOf('{', cjsObject.index + cjsObject[0].length - 1);
      const member = this.memberOfObjectLiteral(balancedSlice(text, open), name);
      if (member) {
        // `{ X }` shorthand points at a local declaration.
        if (member === name) {
          const localDecl = this.findLocalValue(name, text, filePath);
          if (localDecl) return localDecl;
        }
        return { name, kind: 'value', text: member, filePath };
      }
    }
    return null;
  }

  /**
   * Finds `const NAME = …` declared at module level. "Module level" is the
   * file's base indentation, so an indented `const user = …` inside a handler
   * is never mistaken for a shared store of the same name, while files whose
   * every line is indented (embedded snippets) still work.
   */
  private findLocalValue(name: string, text: string, filePath: string, allowExport = false): SymbolDefinition | null {
    const esc = name.replace(/[$]/g, '\\$');
    const base = this.moduleIndent(text);
    const pattern = new RegExp(`(?:^|\\n)([ \\t]*)${allowExport ? '(?:export\\s+)?' : ''}(?:const|let|var)\\s+${esc}\\s*(?::[^=]+)?=(?!=)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m[1].length !== base) continue;
      return { name, kind: 'value', text: readExpression(text, m.index + m[0].length).trim(), filePath };
    }
    return null;
  }

  private moduleIndent(text: string): number {
    let min = Infinity;
    for (const line of text.split('\n')) {
      if (!line.trim() || /^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      const indent = /^[ \t]*/.exec(line)![0].length;
      if (indent < min) min = indent;
      if (min === 0) break;
    }
    return min === Infinity ? 0 : min;
  }

  private memberOfObjectLiteral(objectText: string, member: string): string | null {
    const trimmed = objectText.trim();
    if (!trimmed.startsWith('{')) return null;
    // Entry-aware split: a value ends at its own top-level comma, so the first
    // member no longer swallows the rest of the object (`{ A: 'a', B: 'b' }`).
    const inner = balancedSlice(trimmed, 0).slice(1, -1);
    const entry = objectEntries(inner).find((e) => !e.spread && e.key === member);
    if (!entry) return null;
    return entry.shorthand ? member : entry.value;
  }

  private defaultExportName(text: string): string | null {
    const m = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m.exec(text) || /module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?/.exec(text);
    return m ? m[1] : null;
  }

  private load(filePath: string): FileInfo | null {
    let safePath: string;
    try {
      safePath = resolveExistingPathWithinRoot(this.rootPath, filePath);
    } catch {
      return null;
    }
    const cached = this.files.get(safePath);
    if (cached) return cached;
    let text: string;
    try {
      text = fs.readFileSync(safePath, 'utf-8');
    } catch {
      return null;
    }
    const info = this.index(text, safePath);
    this.files.set(safePath, info);
    return info;
  }

  private index(text: string, filePath: string): FileInfo {
    const imports = new Map<string, { file: string; name: string }>();
    const namespaces = new Map<string, string>();
    const reexports = new Map<string, { file: string; name: string }>();
    const reexportAll: string[] = [];
    let m: RegExpExecArray | null;

    // import X, { A, B as C } from './y'   |   import * as ns from './y'
    const esImport = /import\s+(?:type\s+)?([^'"`;]+?)\s+from\s+['"`]([^'"`]+)['"`]/g;
    while ((m = esImport.exec(text)) !== null) {
      const file = this.resolveFile(m[2], filePath);
      if (!file) continue;
      const clause = m[1].trim();
      const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
      if (ns) namespaces.set(ns[1], file);
      const def = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause);
      if (def) imports.set(def[1], { file, name: 'default' });
      const named = /\{([^}]*)\}/.exec(clause);
      if (named) {
        for (const spec of named[1].split(',')) {
          const parts = spec.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
          if (parts[0]) imports.set((parts[1] || parts[0]).trim(), { file, name: parts[0].trim() });
        }
      }
    }

    // export { A, B as C } from './y'   |   export * from './y'
    const esReexport = /export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"`]([^'"`]+)['"`]/g;
    while ((m = esReexport.exec(text)) !== null) {
      const file = this.resolveFile(m[2], filePath);
      if (!file) continue;
      for (const spec of m[1].split(',')) {
        const parts = spec.trim().split(/\s+as\s+/);
        if (parts[0]) reexports.set((parts[1] || parts[0]).trim(), { file, name: parts[0].trim() });
      }
    }
    const esExportAll = /export\s+\*\s+from\s+['"`]([^'"`]+)['"`]/g;
    while ((m = esExportAll.exec(text)) !== null) {
      const file = this.resolveFile(m[1], filePath);
      if (file) reexportAll.push(file);
    }

    // const { A, B: C } = require('./y')   |   const ns = require('./y')
    const cjsDestructure = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    while ((m = cjsDestructure.exec(text)) !== null) {
      const file = this.resolveFile(m[2], filePath);
      if (!file) continue;
      for (const spec of m[1].split(',')) {
        const parts = spec.trim().split(/\s*:\s*/);
        if (parts[0]) imports.set((parts[1] || parts[0]).trim(), { file, name: parts[0].trim() });
      }
    }
    const cjsNamespace = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    while ((m = cjsNamespace.exec(text)) !== null) {
      const file = this.resolveFile(m[2], filePath);
      if (file) {
        namespaces.set(m[1], file);
        imports.set(m[1], { file, name: 'default' });
      }
    }

    return { text, imports, namespaces, reexports, reexportAll };
  }

  private resolveFile(importPath: string, fromFile: string): string | null {
    if (!importPath.startsWith('.')) return null;
    const base = path.resolve(path.dirname(fromFile), importPath);
    const candidates = [
      base, `${base}.ts`, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.tsx`,
      path.join(base, 'index.ts'), path.join(base, 'index.js'),
    ];
    for (const candidate of candidates) {
      try {
        const safePath = resolveExistingPathWithinRoot(this.rootPath, candidate);
        if (fs.statSync(safePath).isFile()) return safePath;
      } catch { /* try next */ }
    }
    return null;
  }
}
