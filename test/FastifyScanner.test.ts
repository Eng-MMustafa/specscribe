/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { FastifyScanner } from '../src/fastify/FastifyScanner';

describe('FastifyScanner', () => {
  const FIXTURE_SOURCE = 'test/fixtures/fastify-app/src';

  it('finds routes in Fastify route files', () => {
    const controllers = new FastifyScanner().scan(FIXTURE_SOURCE);
    expect(controllers.length).toBe(1);
    expect(controllers[0].name).toBe('UsersRoutes');
  });

  it('extracts methods and paths', () => {
    const controllers = new FastifyScanner().scan(FIXTURE_SOURCE);
    const routes = controllers[0].routes.map(r => `${r.method.toUpperCase()} ${r.path}`).sort();
    expect(routes).toEqual([
      'GET /users',
      'GET /users/{id}',
      'POST /users',
    ]);
  });

  it('returns empty array when no routes exist', () => {
    const controllers = new FastifyScanner().scan('test/fixtures/empty-dir-that-does-not-exist');
    expect(controllers).toEqual([]);
  });
});
