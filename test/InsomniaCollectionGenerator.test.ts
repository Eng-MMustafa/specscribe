/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { InsomniaCollectionGenerator } from '../src/generators/InsomniaCollectionGenerator';
import { ControllerInfo } from '../src/scanner/ScannerService';

const stringType = { type: 'string', isArray: false, isOptional: false };

const usersController: ControllerInfo = {
  name: 'UsersController',
  path: 'users',
  methods: [
    {
      name: 'findAll',
      httpMethod: 'get',
      route: '',
      parameters: [],
      returnType: stringType,
    },
    {
      name: 'create',
      httpMethod: 'post',
      route: '',
      parameters: [
        {
          name: 'body',
          type: {
            type: 'CreateUserDto',
            isArray: false,
            isOptional: false,
            properties: [{ name: 'name', type: stringType }],
          },
          decorator: '@Body()',
          parameterLocation: 'body' as const,
        },
      ],
      returnType: stringType,
    },
  ],
};

describe('InsomniaCollectionGenerator', () => {
  const gen = new InsomniaCollectionGenerator('http://localhost:3000');

  it('generates an Insomnia v4 export', () => {
    const collection = gen.generateCollection([usersController], 'Users API');
    expect(collection._type).toBe('export');
    expect(collection.__export_format).toBe(4);
    expect(collection.resources.some(r => r._type === 'workspace' && r.name === 'Users API')).toBe(true);
  });

  it('groups requests under request_groups', () => {
    const collection = gen.generateCollection([usersController]);
    const groups = collection.resources.filter(r => r._type === 'request_group');
    expect(groups.map(g => (g as any).name)).toContain('UsersController');
  });

  it('creates one request per method', () => {
    const collection = gen.generateCollection([usersController]);
    const requests = collection.resources.filter(r => r._type === 'request');
    expect(requests.map(r => (r as any).name).sort()).toEqual(['GET findAll', 'POST create']);
  });

  it('adds a JSON body when @Body is present', () => {
    const collection = gen.generateCollection([usersController]);
    const createReq = collection.resources.find(r => r._type === 'request' && (r as any).method === 'POST') as any;
    expect(createReq.body.mimeType).toBe('application/json');
    const body = JSON.parse(createReq.body.text);
    expect(body).toHaveProperty('name');
    expect(typeof body.name).toBe('string');
  });
});
