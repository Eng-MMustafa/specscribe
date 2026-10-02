/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { ControllerInfo, MethodInfo } from '../scanner/ScannerService';
import { MockGenerator } from '../utils/MockGenerator';

interface InsomniaCollection {
  _type: 'export';
  __export_format: 4;
  resources: InsomniaResource[];
}

type InsomniaResource = InsomniaWorkspace | InsomniaRequestGroup | InsomniaRequest;

interface InsomniaWorkspace {
  _id: string;
  _type: 'workspace';
  parentId: string;
  name: string;
}

interface InsomniaRequestGroup {
  _id: string;
  _type: 'request_group';
  parentId: string;
  name: string;
}

interface InsomniaRequest {
  _id: string;
  _type: 'request';
  parentId: string;
  name: string;
  url: string;
  method: string;
  headers?: { name: string; value: string }[];
  body?: {
    mimeType?: string;
    text?: string;
  };
  parameters?: { name: string; value: string }[];
}

/**
 * Generates an Insomnia v4 export from scanned controllers.
 */
export class InsomniaCollectionGenerator {
  private baseUrl: string;
  private globalPrefix: string;
  private counter = 0;

  constructor(baseUrl = 'http://localhost:3000', globalPrefix = '') {
    this.baseUrl = baseUrl;
    this.globalPrefix = globalPrefix.replace(/^\/+|\/+$/g, '');
  }

  generateCollection(controllers: ControllerInfo[], collectionName = 'API'): InsomniaCollection {
    const workspaceId = this.id('wrk');
    const resources: InsomniaResource[] = [
      { _id: workspaceId, _type: 'workspace', parentId: '__BASE__', name: collectionName },
    ];

    for (const controller of controllers) {
      const groupId = this.id('fld');
      resources.push({
        _id: groupId,
        _type: 'request_group',
        parentId: workspaceId,
        name: controller.name,
      });

      for (const method of controller.methods) {
        resources.push(this.createRequest(controller, method, groupId));
      }
    }

    return {
      _type: 'export',
      __export_format: 4,
      resources,
    };
  }

  private createRequest(controller: ControllerInfo, method: MethodInfo, groupId: string): InsomniaRequest {
    const fullPath = this.buildPath(this.globalPrefix, controller.path, method.route);
    const request: InsomniaRequest = {
      _id: this.id('req'),
      _type: 'request',
      parentId: groupId,
      name: `${method.httpMethod.toUpperCase()} ${method.name}`,
      url: `${this.baseUrl}${fullPath}`,
      method: method.httpMethod.toUpperCase(),
      headers: [{ name: 'Content-Type', value: 'application/json' }],
    };

    const bodyParam = method.parameters.find(p => p.decorator?.includes('@Body'));
    const queryParam = method.parameters.find(p => p.decorator?.includes('@Query'));

    if (bodyParam?.type.properties) {
      request.body = {
        mimeType: 'application/json',
        text: JSON.stringify(MockGenerator.generateMock(bodyParam.type), null, 2),
      };
    }

    if (queryParam?.type.properties) {
      const mockData = MockGenerator.generateMock(queryParam.type);
      request.parameters = Object.entries(mockData).map(([name, value]) => ({
        name,
        value: String(value),
      }));
    }

    return request;
  }

  private buildPath(...parts: string[]): string {
    return '/' + parts
      .map(p => p.replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
      .join('/')
      .replace(/\/+/g, '/');
  }

  private id(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter.toString(36)}_${Date.now().toString(36)}`;
  }
}
