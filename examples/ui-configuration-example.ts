/**
 * UI Configuration Example
 *
 * Demonstrates SpecScribeModule setup options for the built-in
 * documentation interface.
 */

import { Module } from '@nestjs/common';
import { SpecScribeModule } from 'specscribe';

// ─── Example 1: Minimal setup ────────────────────────────────────────────────
@Module({
  imports: [
    SpecScribeModule.forRoot({
      path: '/api-docs',
      enableMock: true,
    }),
  ],
})
export class AppModule {}

// ─── Example 2: Full configuration ───────────────────────────────────────────
@Module({
  imports: [
    SpecScribeModule.forRoot({
      path: '/api-docs',
      apiTitle: 'My API',
      apiVersion: '1.0.0',
      enableMock: true,
      autoExportPostman: true,
      postmanOutputPath: './postman-collection.json',
    }),
  ],
})
export class AppFullModule {}

// ─── Example 3: Async configuration (e.g. reading from ConfigService) ────────
@Module({
  imports: [
    SpecScribeModule.forRootAsync({
      useFactory: () => ({
        path: '/docs',
        apiTitle: 'My API',
        enableMock: process.env.NODE_ENV !== 'production',
      }),
    }),
  ],
})
export class AppAsyncModule {}
