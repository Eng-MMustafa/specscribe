/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { HonoScanner } from '../src/hono/HonoScanner';

describe('HonoScanner', () => {
  const FIXTURE_SOURCE = 'test/fixtures/hono-app/src';

  it('finds routes in Hono route files', () => {
    const controllers = new HonoScanner().scan(FIXTURE_SOURCE);
    expect(controllers.length).toBe(1);
    expect(controllers[0].name).toBe('PostsRoutes');
  });

  it('extracts methods and paths', () => {
    const controllers = new HonoScanner().scan(FIXTURE_SOURCE);
    const routes = controllers[0].routes.map(r => `${r.method.toUpperCase()} ${r.path}`).sort();
    expect(routes).toEqual([
      'GET /posts',
      'GET /posts/{id}',
      'POST /posts',
    ]);
  });

  it('returns empty array when no routes exist', () => {
    const controllers = new HonoScanner().scan('test/fixtures/empty-dir-that-does-not-exist');
    expect(controllers).toEqual([]);
  });
});
