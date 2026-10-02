import { Hono } from 'hono';

const app = new Hono();

app.get('/posts', (c) => {
  return c.json([]);
});

app.get('/posts/:id', (c) => {
  return c.json({ id: c.req.param('id'), title: 'Hello' });
});

app.post('/posts', async (c) => {
  const body = await c.req.json();
  return c.json(body);
});

export default app;
