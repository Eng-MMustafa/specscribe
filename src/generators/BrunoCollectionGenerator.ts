/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import * as fs from 'fs';
import * as path from 'path';
import { ControllerInfo, MethodInfo } from '../scanner/ScannerService';
import { MockGenerator } from '../utils/MockGenerator';

export interface BrunoFile {
  name: string;
  content: string;
}

/**
 * Generates a Bruno collection: a folder with a `bruno.json` manifest and one
 * `.bru` file per request. The output can be opened directly in the Bruno client.
 */
export class BrunoCollectionGenerator {
  private baseUrl: string;
  private globalPrefix: string;

  constructor(baseUrl = 'http://localhost:3000', globalPrefix = '') {
    this.baseUrl = baseUrl;
    this.globalPrefix = globalPrefix.replace(/^\/+|\/+$/g, '');
  }

  generate(controllers: ControllerInfo[], collectionName = 'API'): BrunoFile[] {
    const files: BrunoFile[] = [];

    files.push({
      name: 'bruno.json',
      content: JSON.stringify({ version: '1', name: collectionName, type: 'collection' }, null, 2),
    });

    for (const controller of controllers) {
      for (const method of controller.methods) {
        const name = `${method.httpMethod.toUpperCase()} ${method.name}`;
        files.push({
          name: `${this.safeFileName(name)}.bru`,
          content: this.createBru(controller, method),
        });
      }
    }

    return files;
  }

  write(outputDir: string, controllers: ControllerInfo[], collectionName = 'API'): string[] {
    const files = this.generate(controllers, collectionName);
    fs.mkdirSync(outputDir, { recursive: true });
    const written: string[] = [];
    for (const file of files) {
      const filePath = path.join(outputDir, file.name);
      fs.writeFileSync(filePath, file.content);
      written.push(filePath);
    }
    return written;
  }

  private createBru(controller: ControllerInfo, method: MethodInfo): string {
    const fullPath = this.buildPath(this.globalPrefix, controller.path, method.route);
    const url = `${this.baseUrl}${fullPath}`;
    const httpMethod = method.httpMethod.toUpperCase();

    const bodyParam = method.parameters.find(p => p.decorator?.includes('@Body'));
    const queryParam = method.parameters.find(p => p.decorator?.includes('@Query'));

    const sections: string[] = [
      'meta {',
      `  name: ${httpMethod} ${method.name}`,
      '  type: http',
      '}',
      '',
      `${httpMethod.toLowerCase()} {`,
      `  url: ${url}`,
      `  body: ${bodyParam ? 'json' : 'none'}`,
      '  auth: none',
      '}',
    ];

    if (bodyParam?.type.properties) {
      sections.push('', 'headers {', '  Content-Type: application/json', '}', '');
      sections.push('body:json {', JSON.stringify(MockGenerator.generateMock(bodyParam.type), null, 2), '}');
    }

    if (queryParam?.type.properties) {
      const mockData = MockGenerator.generateMock(queryParam.type);
      sections.push('', 'params:query {', ...Object.entries(mockData).map(([key, value]) => `  ${key}: ${value}`), '}');
    }

    return sections.join('\n') + '\n';
  }

  private buildPath(...parts: string[]): string {
    return '/' + parts
      .map(p => p.replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
      .join('/')
      .replace(/\/+/g, '/');
  }

  private safeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  }
}
