#!/usr/bin/env node
/**
 * Scans the sample NestJS fixture with whatever `typescript` is installed and
 * checks the outcome matches what that version can do:
 *   - TypeScript 5.x / 6.x → controllers, routes and DTO schemas are found;
 *   - TypeScript 7.x       → nothing is scanned, a clear message explains why,
 *                            and nothing throws (the app would still boot).
 * Runs against dist/, so build first. Used by CI for every TypeScript major.
 */
const path = require('path');
const root = path.resolve(__dirname, '..');
const { version } = require(path.join(root, 'node_modules', 'typescript', 'package.json'));
const { ScannerService } = require(path.join(root, 'dist', 'scanner', 'ScannerService'));
const { OpenApiTransformer } = require(path.join(root, 'dist', 'utils', 'OpenApiTransformer'));
const { typeScriptSupport } = require(path.join(root, 'dist', 'analysis', 'TypeScriptSupport'));
const { SpecScribeLogger } = require(path.join(root, 'dist', 'utils', 'SpecScribeLogger'));

SpecScribeLogger.configure('silent');
const major = Number(version.split('.')[0]);
const support = typeScriptSupport();
const controllers = new ScannerService().scanControllers(path.join(root, 'test', 'fixtures', 'sample-app'));
const spec = new OpenApiTransformer('http://localhost:3000').transform(controllers, 'Compat', '1.0.0');
const paths = Object.keys(spec.paths);
const schemas = Object.keys(spec.components.schemas);

const fail = (msg) => { console.error(`✗ TypeScript ${version}: ${msg}`); process.exit(1); };
if (major <= 6) {
  if (!support.ok) fail(`compiler API reported missing: ${support.message}`);
  if (!controllers.length || !paths.length || !schemas.length) fail(`scan found ${controllers.length} controllers, ${paths.length} paths, ${schemas.length} schemas`);
  console.log(`✓ TypeScript ${version}: ${controllers.length} controller(s), ${paths.length} path(s), ${schemas.length} schema(s)`);
} else {
  if (support.ok) fail('expected no compiler API (update this check if TypeScript 7 gained one)');
  if (paths.length) fail('expected an empty scan');
  if (!/does not expose the compiler API/.test(support.message || '')) fail(`unclear message: ${support.message}`);
  console.log(`✓ TypeScript ${version}: no compiler API — scan skipped cleanly with guidance`);
}
