/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { GatewayInfo } from '../websocket/GatewayScanner';

/**
 * Converts the internal WebSocket gateway model into an AsyncAPI 2.6.0 document.
 *
 * This makes SpecScribe gateways consumable by standard AsyncAPI tooling:
 * generators, validators, documentation viewers, etc.
 */
export function buildAsyncApiDocument(
  gateways: GatewayInfo[],
  info: { title: string; version: string },
): any {
  const channels: Record<string, any> = {};

  for (const gateway of gateways) {
    for (const event of gateway.events) {
      const channelName = gateway.namespace
        ? `${gateway.namespace}/${event.event}`
        : event.event;

      const payload = event.payloadType ? analyzedTypeToJsonSchema(event.payloadType) : {};
      const response = event.returnType ? analyzedTypeToJsonSchema(event.returnType) : {};

      channels[channelName] = {
        ...(event.summary && { title: event.summary }),
        ...(event.description && { description: event.description }),
        publish: {
          operationId: `${gateway.name}_${event.event}_emit`,
          summary: `Emit ${event.event} to ${gateway.name}`,
          message: {
            name: `${event.event}Payload`,
            contentType: 'application/json',
            payload,
          },
        },
        subscribe: {
          operationId: `${gateway.name}_${event.event}_receive`,
          summary: `Receive ${event.event} from ${gateway.name}`,
          message: {
            name: `${event.event}Response`,
            contentType: 'application/json',
            payload: response,
          },
        },
      };
    }
  }

  return {
    asyncapi: '2.6.0',
    info: {
      title: `${info.title} — WebSocket API`,
      version: info.version,
      description: 'AsyncAPI document generated from source-code WebSocket gateway analysis.',
    },
    defaultContentType: 'application/json',
    channels,
  };
}

function analyzedTypeToJsonSchema(type: any): any {
  if (!type) return {};

  if (type.isArray && type.type) {
    return {
      type: 'array',
      items: analyzedTypeToJsonSchema({ ...type, isArray: false }),
    };
  }

  const basic = mapBasicType(type.type);
  if (basic) {
    const schema: any = { type: basic };
    if (type.format) schema.format = type.format;
    if (type.description) schema.description = type.description;
    if (type.enumValues) schema.enum = type.enumValues;
    return schema;
  }

  if (type.type === 'object' && type.properties) {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const prop of type.properties) {
      properties[prop.name] = analyzedTypeToJsonSchema(prop.type);
      if (prop.description) properties[prop.name].description = prop.description;
      if (!prop.type?.isOptional && !prop.optional) {
        required.push(prop.name);
      }
    }
    const schema: any = { type: 'object', properties };
    if (required.length) schema.required = required;
    if (type.description) schema.description = type.description;
    return schema;
  }

  // Fallback: treat unknown types as object references.
  if (type.type && type.type !== 'any' && type.type !== 'unknown') {
    return { type: 'object', title: type.type };
  }

  return {};
}

function mapBasicType(type: string): string | null {
  switch (type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
      return type;
    case 'enum':
      return 'string';
    case 'date':
      return 'string';
    default:
      return null;
  }
}
