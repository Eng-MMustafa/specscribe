/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { GoClientGenerator } from '../src/generators/GoClientGenerator';

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

describe('GoClientGenerator', () => {
  it('generates structs for schemas', () => {
    const code = new GoClientGenerator().generate(spec);
    expect(code).toContain('type User struct');
    expect(code).toContain('Id int');
    expect(code).toContain('Name string');
  });

  it('generates a Client with methods', () => {
    const code = new GoClientGenerator().generate(spec);
    expect(code).toContain('type Client struct');
    expect(code).toContain('func GetUsers(');
    expect(code).toContain('http.NewRequest(');
  });
});
