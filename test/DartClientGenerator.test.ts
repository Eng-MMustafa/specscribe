/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { DartClientGenerator } from '../src/generators/DartClientGenerator';

const spec = {
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  servers: [{ url: 'http://localhost:3000' }],
  paths: {
    '/users': {
      get: {
        operationId: 'getUsers',
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

describe('DartClientGenerator', () => {
  it('generates Dart classes for schemas', () => {
    const code = new DartClientGenerator().generate(spec);
    expect(code).toContain('class User');
    expect(code).toContain('factory User.fromJson');
    expect(code).toContain('Map<String, dynamic> toJson');
  });

  it('generates an ApiClient with methods', () => {
    const code = new DartClientGenerator().generate(spec);
    expect(code).toContain('class ApiClient');
    expect(code).toContain('Future<http.Response> getUsers');
  });
});
