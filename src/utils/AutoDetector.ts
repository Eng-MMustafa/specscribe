/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import * as fs from 'fs';
import * as path from 'path';
import { SpecScribeLogger } from './SpecScribeLogger';

export type Framework = 'nestjs' | 'express' | 'fastify' | 'hono' | 'unknown';

export interface ProjectStructure {
  rootPath: string;
  sourcePath: string;
  packageJson: any;
  tsConfigPath: string;
  framework: Framework;
  hasControllers: boolean;
  controllerPaths: string[];
}

/** Directory names that are never part of a project's own source. */
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

/** Candidate source directories, in order of preference. */
const SOURCE_CANDIDATES = ['src', 'lib', 'app', 'source'];

/**
 * Depth limit for the source scan.
 *
 * Deep enough for any realistic layout while keeping startup cheap on large
 * trees.
 */
const MAX_SCAN_DEPTH = 8;

/**
 * Addresses a server binds to but a client cannot connect to.
 *
 * `HOST=0.0.0.0` is the norm in containers, and it used to be copied straight
 * into the documented server URL. A browser cannot reach `http://0.0.0.0`, so
 * the docs UI pointed "Try it" at an unusable address.
 */
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]', '::0', '0']);

export class AutoDetector {
  /**
   * Auto-detect the project structure and configuration.
   *
   * @param sourcePathHint Optional source path or project root hint. When an
   * absolute path is provided the detector walks up to the nearest
   * `package.json` instead of assuming `process.cwd()` owns the project.
   */
  static detectProjectStructure(sourcePathHint?: string): ProjectStructure {
    const hint = sourcePathHint ? path.resolve(sourcePathHint) : undefined;
    const rootPath = this.findProjectRoot(hint || process.cwd());

    // Try to find package.json
    const packageJsonPath = path.join(rootPath, 'package.json');
    let packageJson: any = {};

    if (fs.existsSync(packageJsonPath)) {
      try {
        packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      } catch (error) {
        SpecScribeLogger.warn('Could not parse package.json');
      }
    }

    // Auto-detect source path, but trust an explicit hint when it lives under root.
    let sourcePath = this.detectSourcePath(rootPath);
    if (hint && this.isWithinProject(hint, rootPath)) {
      sourcePath = path.relative(rootPath, hint).replace(/\\/g, '/');
    }

    // Find tsconfig.json
    const tsConfigPath = this.detectTsConfig(rootPath);

    // Find controllers
    const controllerPaths = this.findControllers(path.join(rootPath, sourcePath));
    const framework = this.detectFramework(packageJson);

    return {
      rootPath,
      sourcePath,
      packageJson,
      tsConfigPath,
      framework,
      hasControllers: controllerPaths.length > 0,
      controllerPaths,
    };
  }

  /**
   * Returns true when `candidate` is a directory inside `rootPath`.
   */
  private static isWithinProject(candidate: string, rootPath: string): boolean {
    try {
      const rel = path.relative(rootPath, candidate);
      return !rel.startsWith('..') && rel !== '';
    } catch {
      return false;
    }
  }

  /**
   * Walks up from the starting directory until it finds a `package.json`.
   *
   * This matters when the library is run from a directory other than the
   * project under scan, or when `sourcePath` points deep into a project tree.
   */
  private static findProjectRoot(startPath: string): string {
    const absolute = path.resolve(startPath);
    let current = absolute;

    // If the hint itself is a file, start from its parent directory.
    try {
      const stat = fs.statSync(current);
      if (stat.isFile()) current = path.dirname(current);
    } catch {
      // fall through to use the path as-is
    }

    do {
      if (fs.existsSync(path.join(current, 'package.json'))) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    } while (current);

    return process.cwd();
  }

  /**
   * Detect whether the project is a NestJS app, an Express app, or unknown.
   * NestJS wins over Express because a NestJS project also lists express as a
   * transitive platform dependency.
   */
  static detectFramework(packageJson: any): Framework {
    const deps = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };
    if (deps['@nestjs/core']) return 'nestjs';
    if (deps['hono']) return 'hono';
    if (deps['fastify']) return 'fastify';
    if (deps['express']) return 'express';
    return 'unknown';
  }

  /**
   * Auto-detect the source directory.
   *
   * A directory that actually declares a controller wins over one that merely
   * holds TypeScript, because that is the signal the library needs. The previous
   * check looked only at the top level of each candidate, so a project whose
   * source lives entirely in subdirectories was not detected and the user saw
   * "No controllers found" with nothing to act on.
   */
  private static detectSourcePath(rootPath: string): string {
    const existing = SOURCE_CANDIDATES.filter(candidate => {
      const fullPath = path.join(rootPath, candidate);
      return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
    });

    for (const candidate of existing) {
      if (this.findControllers(path.join(rootPath, candidate)).length > 0) {
        return candidate;
      }
    }

    for (const candidate of existing) {
      if (this.hasTypeScriptFiles(path.join(rootPath, candidate))) {
        return candidate;
      }
    }

    // Plain-JavaScript projects (Express/Fastify/Hono): the first conventional
    // folder that holds code, else the project root (node_modules is skipped
    // by every scanner), so `npx specscribe` works without arguments.
    for (const candidate of existing) {
      if (this.hasTypeScriptFiles(path.join(rootPath, candidate), 0, /\.(m|c)?js$/)) {
        return candidate;
      }
    }
    if (!existing.length && this.hasTypeScriptFiles(rootPath, MAX_SCAN_DEPTH - 1, /\.(m|c)?[jt]s$/)) {
      return '.';
    }

    return 'src';
  }

  /**
   * Detect tsconfig.json location
   */
  private static detectTsConfig(rootPath: string): string {
    const possiblePaths = [
      'tsconfig.json',
      'tsconfig.app.json',
      'tsconfig.build.json',
    ];
    
    for (const possiblePath of possiblePaths) {
      const fullPath = path.join(rootPath, possiblePath);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    
    return path.join(rootPath, 'tsconfig.json');
  }

  /**
   * Checks for TypeScript files anywhere under a directory.
   *
   * The scan is recursive because many projects keep no `.ts` file at the top
   * level of their source directory; a shallow check reported those as empty.
   */
  private static hasTypeScriptFiles(dirPath: string, depth = 0, pattern: RegExp = /\.ts$/): boolean {
    if (depth > MAX_SCAN_DEPTH) return false;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      if (entry.isFile() && pattern.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        return true;
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      if (this.hasTypeScriptFiles(path.join(dirPath, entry.name), depth + 1, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Find all controller files recursively
   */
  private static findControllers(dirPath: string, controllers: string[] = [], depth = 0): string[] {
    if (depth > MAX_SCAN_DEPTH || !fs.existsSync(dirPath)) {
      return controllers;
    }

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) {
            this.findControllers(fullPath, controllers, depth + 1);
          }
        } else if (entry.isFile() && entry.name.endsWith('.controller.ts')) {
          controllers.push(fullPath);
        }
      }
    } catch (error) {
      // Silently skip directories we cannot read.
    }

    return controllers;
  }

  /**
   * Reads the port from the environment.
   *
   * The value is validated because `parseInt('abc')` returns `NaN`, which used to
   * end up in the documented server URL as `http://localhost:NaN`.
   */
  static detectPort(): number {
    const raw = process.env.PORT;
    if (!raw) return 3000;

    const parsed = Number(raw.trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      SpecScribeLogger.warn(`Ignoring invalid PORT value "${raw}"; using 3000 instead`);
      return 3000;
    }

    return parsed;
  }

  /**
   * Builds the base URL advertised in the document and the docs UI.
   *
   * A wildcard bind address is rewritten to `localhost`: `0.0.0.0` is where the
   * server listens, not somewhere a client can connect, so copying it into the
   * spec produced a "Try it" button that could never work.
   */
  static detectBaseUrl(): string {
    const port = this.detectPort();
    const rawHost = (process.env.HOST || '').trim();
    const host = !rawHost || WILDCARD_HOSTS.has(rawHost) ? 'localhost' : rawHost;

    return `http://${host}:${port}`;
  }

  /**
   * Get app name from package.json or default.
   *
   * @param rootPath Optional project root to read `package.json` from.
   */
  static getAppName(rootPath: string = process.cwd()): string {
    try {
      const packageJsonPath = path.join(rootPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        return packageJson.name || 'NestJS API';
      }
    } catch {
      // Ignore
    }
    return 'NestJS API';
  }

  /**
   * Get app version from package.json or default.
   *
   * @param rootPath Optional project root to read `package.json` from.
   */
  static getAppVersion(rootPath: string = process.cwd()): string {
    try {
      const packageJsonPath = path.join(rootPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        return packageJson.version || '1.0.0';
      }
    } catch {
      // Ignore
    }
    return '1.0.0';
  }
}
