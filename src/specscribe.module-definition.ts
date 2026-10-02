/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { ConfigurableModuleBuilder } from '@nestjs/common';
import { SpecScribeOptions } from './SpecScribeModule';

/**
 * Modern NestJS 10+ ConfigurableModuleBuilder approach
 * This provides type-safe module configuration with better DX
 */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
  new ConfigurableModuleBuilder<SpecScribeOptions>({
    moduleName: 'SpecScribe',
  })
    .setClassMethodName('forRoot')
    .setFactoryMethodName('createSpecScribeOptions')
    .build();

export type SpecScribeModuleOptions = typeof OPTIONS_TYPE;
export type SpecScribeModuleAsyncOptions = typeof ASYNC_OPTIONS_TYPE;
