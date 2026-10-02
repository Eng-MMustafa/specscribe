/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BrunoCollectionGenerator } from '../src/generators/BrunoCollectionGenerator';
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

describe('BrunoCollectionGenerator', () => {
  const gen = new BrunoCollectionGenerator('http://localhost:3000');

  it('generates a manifest and one file per request', () => {
    const files = gen.generate([usersController], 'Users API');
    const names = files.map(f => f.name).sort();
    expect(names).toContain('bruno.json');
    expect(names.filter(n => n.endsWith('.bru')).length).toBe(2);
  });

  it('writes a Bruno collection folder', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-'));
    gen.write(tmpDir, [usersController], 'Users API');
    expect(fs.existsSync(path.join(tmpDir, 'bruno.json'))).toBe(true);
    const bruFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.bru'));
    expect(bruFiles.length).toBe(2);
  });

  it('includes request metadata and body', () => {
    const files = gen.generate([usersController]);
    const createFile = files.find(f => f.name.includes('create'));
    expect(createFile).toBeDefined();
    expect(createFile!.content).toContain('meta {');
    expect(createFile!.content).toContain('post {');
    expect(createFile!.content).toContain('body:json {');
  });
});
