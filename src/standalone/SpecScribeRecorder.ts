/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import * as fs from 'fs';
import * as path from 'path';
import { matchSpecPath } from '../drift/DriftDetector';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface RecordedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Records real HTTP traffic passing through the standalone docs proxy and turns
 * it into replayable scenario files. Each documented operation gets its own
 * scenario file; repeated calls append new steps.
 */
export class SpecScribeRecorder {
  constructor(
    private readonly recordDir: string,
    private readonly spec: any,
  ) {
    if (!fs.existsSync(recordDir)) {
      fs.mkdirSync(recordDir, { recursive: true });
    }
  }

  /**
   * Records one completed request/response pair as a scenario step. The request
   * path is normalised to the documented spec path template so recorded steps
   * stay portable across environments.
   */
  save(req: RecordedRequest, res: RecordedResponse): void {
    const url = new URL(req.url);
    const specPath = matchSpecPath(this.spec, url.pathname);
    if (!specPath) return;

    const operation = this.spec.paths[specPath]?.[req.method.toLowerCase()];
    if (!operation) return;

    const fileName = this.sanitizeFileName(`${req.method} ${specPath}`) + '.scenario.json';
    const filePath = path.join(this.recordDir, fileName);

    const scenario = this.readScenario(filePath, specPath, operation);
    const recordedPath = this.toSpecPath(specPath, url.pathname);

    const step = {
      name: `${req.method.toUpperCase()} ${recordedPath}`,
      request: {
        method: req.method.toUpperCase(),
        path: recordedPath + url.search,
        headers: this.selectInterestingHeaders(req.headers),
        body: this.parseJsonBody(req.body),
      },
      expect: {
        status: res.status,
        matchesSpec: true,
      },
    };

    scenario.steps.push(step);
    fs.writeFileSync(filePath, JSON.stringify(scenario, null, 2));
  }

  private readScenario(filePath: string, specPath: string, operation: any): any {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (existing && Array.isArray(existing.steps)) return existing;
    } catch {
      // File does not exist or is corrupt; start fresh.
    }
    return {
      name: `${operation.summary || 'Recorded'}: ${specPath}`,
      baseUrl: this.baseUrlFromSpec(),
      steps: [],
    };
  }

  private baseUrlFromSpec(): string | undefined {
    return this.spec?.servers?.[0]?.url;
  }

  private toSpecPath(specPath: string, actualPath: string): string {
    const specSegments = specPath.split('/');
    const actualSegments = actualPath.split('/');
    if (specSegments.length !== actualSegments.length) return actualPath;
    return specSegments
      .map((segment, i) => (segment.startsWith('{') && segment.endsWith('}') ? segment : actualSegments[i]))
      .join('/');
  }

  private selectInterestingHeaders(headers: Record<string, string>): Record<string, string> | undefined {
    const interesting: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'authorization' || lower === 'content-type') {
        interesting[key] = value;
      }
    }
    return Object.keys(interesting).length > 0 ? interesting : undefined;
  }

  private parseJsonBody(body: string): unknown {
    if (!body) return undefined;
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  private sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
  }
}
