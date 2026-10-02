/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { RtkQueryGenerator } from '../src/generators/RtkQueryGenerator';

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

describe('RtkQueryGenerator', () => {
  it('generates a createApi slice', () => {
    const code = new RtkQueryGenerator().generate(spec);
    expect(code).toContain("import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';");
    expect(code).toContain('export const api = createApi({');
  });

  it('creates query endpoints for GET and mutation for others', () => {
    const code = new RtkQueryGenerator().generate(spec);
    expect(code).toContain('getUsers: builder.query<any, void>({');
    expect(code).toContain('createUser: builder.mutation<any, any>({');
    expect(code).toContain('export const { getUsers, createUser } = api;');
  });
});
