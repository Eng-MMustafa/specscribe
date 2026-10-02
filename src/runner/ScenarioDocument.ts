/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import * as fs from 'fs';
import * as path from 'path';
import { generateScenarios } from './ScenarioGenerator';
import { Scenario } from './ScenarioRunner';

export interface ScenarioDocument {
  scenarios: Array<Scenario & { source: 'generated' | 'recorded' }>;
}

const MAX_RECORDED_FILES = 200;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Scenarios the docs UI can run: one generated flow per tag (login → create →
 * read → update → delete) plus any `*.scenario.json` recorded from real traffic.
 * Same format as `specscribe test`, so a flow tried in the browser runs in CI.
 */
export function buildScenarioDocument(spec: any, recordDir?: string): ScenarioDocument {
  let generated: Scenario[] = [];
  try {
    generated = generateScenarios(spec);
  } catch {
    generated = [];
  }
  return {
    scenarios: [
      ...readRecordedScenarios(recordDir).map((s) => ({ ...s, source: 'recorded' as const })),
      ...generated.map((s) => ({ ...s, source: 'generated' as const })),
    ],
  };
}

function readRecordedScenarios(recordDir?: string): Scenario[] {
  if (!recordDir) return [];
  let files: string[];
  try {
    files = fs.readdirSync(recordDir).filter((f) => f.endsWith('.scenario.json')).sort().slice(0, MAX_RECORDED_FILES);
  } catch {
    return [];
  }
  const scenarios: Scenario[] = [];
  for (const file of files) {
    const full = path.join(recordDir, file);
    try {
      if (fs.lstatSync(full).isSymbolicLink() || fs.statSync(full).size > MAX_FILE_BYTES) continue;
      const parsed = JSON.parse(fs.readFileSync(full, 'utf-8'));
      if (parsed && typeof parsed.name === 'string' && Array.isArray(parsed.steps)) scenarios.push(parsed);
    } catch {
      // A half-written or hand-broken file must not break the docs page.
    }
  }
  return scenarios;
}
