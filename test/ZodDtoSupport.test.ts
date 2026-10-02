import { AnalyzedType } from '../src/utils/DtoAnalyzer';
import { ControllerInfo, MethodInfo, ScannerService } from '../src/scanner/ScannerService';
import { SpecScribeLogger } from '../src/utils/SpecScribeLogger';

const FIXTURE_SOURCE = 'test/fixtures/zod-app/src';

describe('nestjs-zod DTO support', () => {
  jest.setTimeout(120_000);

  let controller: ControllerInfo;

  const method = (name: string): MethodInfo => {
    const found = controller.methods.find((m) => m.name === name);
    if (!found) throw new Error(`Fixture method "${name}" not found`);
    return found;
  };

  const bodyType = (methodName: string): AnalyzedType => {
    const body = method(methodName).parameters.find((p) => p.parameterLocation === 'body');
    if (!body) throw new Error(`Fixture method "${methodName}" has no body parameter`);
    return body.type;
  };

  const prop = (type: AnalyzedType, name: string) => {
    const found = type.properties?.find((p) => p.name === name);
    if (!found) throw new Error(`Property "${name}" not found on ${type.type}`);
    return found;
  };

  const names = (type: AnalyzedType): string[] =>
    (type.properties ?? []).map((p) => p.name).sort();

  beforeAll(() => {
    SpecScribeLogger.configure('silent');
    const controllers = new ScannerService().scanControllers(FIXTURE_SOURCE);
    controller = controllers.find((c) => c.name === 'UsersController')!;
  });

  afterAll(() => {
    SpecScribeLogger.configure('info');
  });

  it('resolves properties from a Zod object schema', () => {
    expect(names(bodyType('create'))).toEqual(
      ['active', 'age', 'email', 'name', 'roles'].sort(),
    );
  });

  it('maps Zod string primitives and constraints', () => {
    const name = prop(bodyType('create'), 'name');
    expect(name.type.type).toBe('string');
    expect(name.type.isOptional).toBe(false);
    expect(name.validation?.minLength).toBe(2);
    expect(name.validation?.maxLength).toBe(80);
    expect(name.description).toBe('User full name');
  });

  it('maps Zod email format', () => {
    const email = prop(bodyType('create'), 'email');
    expect(email.type.type).toBe('string');
    expect(email.validation?.format).toBe('email');
  });

  it('maps Zod optional to isOptional', () => {
    const age = prop(bodyType('create'), 'age');
    expect(age.type.type).toBe('number');
    expect(age.type.isOptional).toBe(true);
  });

  it('maps Zod array and enum values', () => {
    const roles = prop(bodyType('create'), 'roles');
    expect(roles.type.isArray).toBe(true);
    expect(roles.type.type).toBe('string');
    expect(roles.type.enumValues?.sort()).toEqual(['admin', 'user']);
  });

  it('maps Zod boolean primitives', () => {
    const active = prop(bodyType('create'), 'active');
    expect(active.type.type).toBe('boolean');
    expect(active.type.isOptional).toBe(false);
  });
});
