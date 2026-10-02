/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { PythonClientGenerator } from '../src/generators/PythonClientGenerator';

const spec = {
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  servers: [{ url: 'http://localhost:3000' }],
  paths: {
    '/users': {
      get: {
        operationId: 'get_users',
        summary: 'List users',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
        },
        required: ['id', 'name'],
      },
    },
  },
};

describe('PythonClientGenerator', () => {
  it('generates a dataclass for each schema', () => {
    const code = new PythonClientGenerator().generate(spec);
    expect(code).toContain('@dataclass');
    expect(code).toContain('class User:');
    expect(code).toContain('id: int');
    expect(code).toContain('name: str');
  });

  it('generates an ApiClient class with request methods', () => {
    const code = new PythonClientGenerator().generate(spec);
    expect(code).toContain('class ApiClient:');
    expect(code).toContain('def get_users(');
    expect(code).toContain('requests.request(');
  });
});
