/**
 * Tests for the Express docs naming helpers (group labels + body schema names).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  bodySchemaName, friendlyName, friendlyNames, humanizeIdentifier, operationIdFrom, routeSummary,
} from '../src/express/ExpressNaming';
import { ExpressScanner } from '../src/express/ExpressScanner';
import { ExpressOpenApiTransformer } from '../src/express/ExpressOpenApiTransformer';

describe('ExpressNaming', () => {
  describe('friendlyName', () => {
    it.each([
      ['src/routes/orders.js', 'Orders'],
      ['src/users.routes.ts', 'Users'],
      ['src/api/products.controller.js', 'Products'],
      ['src/websocket/orders.gateway.js', 'OrdersGateway'],
      ['src/app.js', 'App'],
      ['src/orders/index.js', 'Orders'],
      ['src/routes/index.js', 'Index'],
      ['src/graphql/schema.js', 'Schema'],
    ])('%s → %s', (file, expected) => {
      expect(friendlyName(file)).toBe(expected);
    });
  });

  it('disambiguates colliding names with the parent directory', () => {
    const names = friendlyNames(['src/admin/users.js', 'src/public/users.js', 'src/orders.js']);
    expect(names.get('src/admin/users.js')).toBe('AdminUsers');
    expect(names.get('src/public/users.js')).toBe('PublicUsers');
    expect(names.get('src/orders.js')).toBe('Orders');
  });

  describe('bodySchemaName', () => {
    it.each([
      ['post', '/api/users', 'CreateUserBody'],
      ['put', '/api/users/{id}', 'UpdateUserBody'],
      ['patch', '/api/v1/categories/{id}', 'UpdateCategoryBody'],
      ['post', '/api/auth/login', 'LoginBody'],
      ['post', '/api/products/{id}/image', 'ImageBody'],
    ])('%s %s → %s', (method, routePath, expected) => {
      expect(bodySchemaName(method, routePath)).toBe(expected);
    });
  });
});

describe('ExpressOpenApiTransformer — named body schemas', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'specscribe-express-naming-'));
    fs.mkdirSync(path.join(root, 'src/routes'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/app.js'), `
      const express = require('express');
      const app = express();
      app.use('/api/users', require('./routes/users'));
      app.listen(3000);
    `);
    fs.writeFileSync(path.join(root, 'src/routes/users.js'), `
      const router = require('express').Router();
      router.post('/', (req, res) => {
        const { name, email } = req.body;
        if (!name || !email) return res.status(400).json({});
        res.status(201).json({});
      });
      router.put('/:id', (req, res) => {
        const { name } = req.body;
        res.json({});
      });
      module.exports = router;
    `);
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('labels groups like controllers and registers bodies as components', () => {
    const controllers = ExpressScanner.scan(path.join(root, 'src'));
    expect(controllers.map((c) => c.name)).toEqual(['Users']);

    const spec = new ExpressOpenApiTransformer().transform(controllers);
    expect(Object.keys(spec.components.schemas).sort()).toEqual(['CreateUserBody', 'UpdateUserBody']);
    expect(spec.components.schemas.CreateUserBody).toEqual({
      type: 'object',
      description: 'Inferred from destructuring',
      properties: { name: { type: 'string' }, email: { type: 'string' } },
      required: ['name', 'email'],
    });
    expect(spec.paths['/api/users'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/CreateUserBody',
    });
    expect(spec.paths['/api/users'].post.tags).toEqual(['Users']);
  });
});

describe('route names', () => {
  it.each([
    ['get', '/api/users', 'List users'],
    ['get', '/api/users/{id}', 'Get user'],
    ['post', '/api/users', 'Create user'],
    ['put', '/api/users/{id}', 'Update user'],
    ['delete', '/api/users/{id}', 'Delete user'],
    ['post', '/api/auth/login', 'Login'],
    ['post', '/api/orders/{id}/cancel', 'Cancel order'],
    ['get', '/api/orders/{id}/items', 'List order items'],
    ['post', '/api/orders/{id}/items', 'Create order item'],
    ['get', '/health', 'Get health'],
    ['get', '/api/v2/categories', 'List categories'],
  ])('%s %s → %s', (method, route, expected) => {
    expect(routeSummary(method, route)).toBe(expected);
  });

  it('names file uploads as uploads', () => {
    expect(routeSummary('post', '/api/products/{id}/image', true)).toBe('Upload product image');
  });

  it.each([
    ['getUserById', 'Get user by id'],
    ['UserController.listAll', 'List all'],
    ['handleLogin', 'Login'],
    ['createOrderHandler', 'Create order'],
    ['handler', ''],
  ])('humanizes %s → "%s"', (name, expected) => {
    expect(humanizeIdentifier(name)).toBe(expected);
  });

  it('builds identifier-safe operation ids', () => {
    expect(operationIdFrom('Create user')).toBe('createUser');
    expect(operationIdFrom('Upload product image')).toBe('uploadProductImage');
    expect(operationIdFrom('2fa verify')).toBe('op2faVerify');
  });

  describe('in a scanned project', () => {
    let spec: ReturnType<ExpressOpenApiTransformer['transform']>;
    let dir: string;

    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specscribe-express-names-'));
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src/orders.js'), `
        const router = require('express').Router();

        /**
         * List all orders.
         * Newest first.
         */
        router.get('/orders', (req, res) => res.json([]));

        router.post('/orders', requireAuth, createOrder);

        /** Cancel an order that has not shipped yet. */
        async function cancelOrder(req, res) { res.json({ ok: true }); }
        router.post('/orders/:id/cancel', cancelOrder);

        router.get('/orders/:id', (req, res) => res.json({}));

        /** A comment for something else. */
        const unrelated = 1;
        router.delete('/orders/:id', (req, res) => res.sendStatus(204));
        module.exports = router;
      `);
      spec = new ExpressOpenApiTransformer().transform(ExpressScanner.scan(path.join(dir, 'src')));
    });

    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('uses the JSDoc above the route (first line → summary, rest → description)', () => {
      expect(spec.paths['/orders'].get.summary).toBe('List all orders');
      expect(spec.paths['/orders'].get.description).toBe('Newest first.');
    });

    it("uses the referenced handler's JSDoc, then its name", () => {
      expect(spec.paths['/orders/{id}/cancel'].post.summary).toBe('Cancel an order that has not shipped yet');
      expect(spec.paths['/orders'].post.summary).toBe('Create order');
      expect(spec.paths['/orders'].post.operationId).toBe('createOrder');
    });

    it('does not borrow a comment that belongs to other code', () => {
      expect(spec.paths['/orders/{id}'].delete.summary).toBe('Delete order');
    });

    it('falls back to a REST-style name with unique operation ids', () => {
      expect(spec.paths['/orders/{id}'].get.summary).toBe('Get order');
      const ids = Object.values(spec.paths).flatMap((m) => Object.values<any>(m).map((o) => o.operationId));
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
