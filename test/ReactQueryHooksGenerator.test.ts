/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { ReactQueryHooksGenerator } from '../src/generators/ReactQueryHooksGenerator';

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
    '/users/create': {
      post: {
        operationId: 'createUser',
        summary: 'Create user',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
  },
};

describe('ReactQueryHooksGenerator', () => {
  it('generates useQuery for GET operations', () => {
    const code = new ReactQueryHooksGenerator().generate(spec);
    expect(code).toContain("export function useGetUsers(");
    expect(code).toContain('useQuery');
  });

  it('generates useMutation for non-GET operations', () => {
    const code = new ReactQueryHooksGenerator().generate(spec);
    expect(code).toContain("export function useCreateUser(");
    expect(code).toContain('useMutation');
  });
});
