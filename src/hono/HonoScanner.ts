/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import * as fs from 'fs';
import * as path from 'path';
import { ExpressControllerInfo, ExpressRouteInfo } from '../express/ExpressScanner';

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  'test',
  'tests',
  '__tests__',
]);

/**
 * Heuristic scanner for Hono routes.
 *
 * Covers the common patterns:
 *   app.get('/path', ...)
 *   hono.post('/path', ...)
 *   api.delete('/path', ...)
 *
 * Hono path params are already `{param}`, so no `:param` conversion is needed.
 */
export class HonoScanner {
  scan(sourcePath: string): ExpressControllerInfo[] {
    const files = this.listSourceFiles(sourcePath);
    const controllers: ExpressControllerInfo[] = [];

    for (const filePath of files) {
      const text = fs.readFileSync(filePath, 'utf-8');
      const routes = this.extractRoutes(text, filePath);
      if (routes.length === 0) continue;

      const relative = path.relative(sourcePath, filePath).replace(/\\/g, '/');
      const name = this.controllerName(relative);

      controllers.push({
        name,
        filePath: relative,
        basePath: '',
        routes,
      });
    }

    return controllers;
  }

  private listSourceFiles(dirPath: string, depth = 0): string[] {
    if (depth > 5) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          files.push(...this.listSourceFiles(fullPath, depth + 1));
        }
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private extractRoutes(text: string, _filePath: string): ExpressRouteInfo[] {
    const routes: ExpressRouteInfo[] = [];
    const seen = new Set<string>();

    // Matches: app.get('/path', ...) or hono.post('/path', ...)
    const pattern = /(\w+)\s*\.\s*(get|post|put|delete|patch|options|head|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const [, , method, routePath] = match;
      const normalizedPath = this.normalizePath(routePath);
      const key = `${method.toLowerCase()}:${normalizedPath}`;
      if (seen.has(key)) continue;
      seen.add(key);

      routes.push({
        method: method.toLowerCase(),
        path: normalizedPath,
        summary: `${method.toUpperCase()} ${normalizedPath}`,
        responses: {
          '200': { description: 'OK' },
        },
      });
    }

    return routes;
  }

  private normalizePath(routePath: string): string {
    let normalized = routePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    // Hono path params are `:param`; OpenAPI uses `{param}`.
    normalized = normalized.replace(/:([^/]+)/g, '{$1}');
    return normalized ? '/' + normalized : '/';
  }

  private controllerName(relativePath: string): string {
    const base = path.basename(relativePath, '.ts');
    return base.charAt(0).toUpperCase() + base.slice(1) + 'Routes';
  }
}
