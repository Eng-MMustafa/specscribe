import { FastifyInstance } from 'fastify';

export default async function userRoutes(app: FastifyInstance) {
  app.get('/users', async () => {
    return [{ id: 1, name: 'Alice' }];
  });

  app.get('/users/:id', async (req) => {
    // @ts-ignore
    return { id: req.params.id, name: 'Alice' };
  });

  app.post('/users', async (req) => {
    return req.body;
  });
}
