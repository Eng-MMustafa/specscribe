/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import * as ts from 'typescript';
import { AnalyzedType, PropertyInfo } from './DtoAnalyzer';
import { ValidationConstraints } from './ValidationExtractor';

/**
 * Extracts property information from DTOs created with `nestjs-zod`.
 *
 * `class CreateUserDto extends createZodDto(z.object({ ... })) {}` carries its
 * shape in the AST of the `z.object` call argument. The TypeScript checker can
 * usually reconstruct the type, but reading the Zod schema lets us recover
 * validation constraints, enum values, defaults and descriptions even when no
 * `class-validator` decorators are present.
 */
export class ZodSchemaExtractor {
  constructor(private readonly checker: ts.TypeChecker) {}

  /**
   * Returns the DTO properties described by a Zod schema, or an empty array
   * if the class does not extend `createZodDto(...)`.
   */
  extractFromClass(decl: ts.ClassDeclaration | ts.InterfaceDeclaration): PropertyInfo[] {
    if (!ts.isClassDeclaration(decl) || !decl.heritageClauses) return [];

    for (const clause of decl.heritageClauses) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
      for (const typeNode of clause.types) {
        const props = this.extractFromExpression(typeNode.expression, decl.getSourceFile());
        if (props) return props;
      }
    }
    return [];
  }

  private extractFromExpression(expr: ts.Expression, sourceFile: ts.SourceFile): PropertyInfo[] | null {
    if (!this.isCallExpressionNamed(expr, 'createZodDto')) return null;
    const call = expr as ts.CallExpression;
    const schemaArg = call.arguments[0];
    if (!schemaArg) return null;
    return this.extractShape(schemaArg, sourceFile);
  }

  private extractShape(node: ts.Node, sourceFile: ts.SourceFile): PropertyInfo[] | null {
    // z.object({ ... })
    if (this.isCallExpressionNamed(node, 'object')) {
      const obj = this.unwrapCall(node as ts.CallExpression);
      const arg = obj.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        return arg.properties.map(p => this.propertyFromObjectMember(p, sourceFile)).filter(Boolean) as PropertyInfo[];
      }
      return [];
    }

    // Direct inline object literal (createZodDto({ ... })) — less common.
    if (ts.isObjectLiteralExpression(node)) {
      return node.properties.map(p => this.propertyFromObjectMember(p, sourceFile)).filter(Boolean) as PropertyInfo[];
    }

    // Reference to a local const schema = z.object({ ... })
    if (ts.isIdentifier(node)) {
      const initializer = this.resolveIdentifierInitializer(node, sourceFile);
      if (initializer) return this.extractShape(initializer, sourceFile);
    }

    return null;
  }

  private propertyFromObjectMember(member: ts.ObjectLiteralElementLike, sourceFile: ts.SourceFile): PropertyInfo | null {
    if (!ts.isPropertyAssignment(member) && !ts.isShorthandPropertyAssignment(member)) return null;
    const name = this.propertyNameText(member.name);
    if (!name) return null;

    const value = ts.isShorthandPropertyAssignment(member)
      ? this.resolveIdentifierInitializer(member.name, sourceFile)
      : member.initializer;
    if (!value) return null;

    const { type, validation, description } = this.analyzeZodType(value, sourceFile);
    return {
      name,
      type,
      description,
      validation,
    };
  }

  private analyzeZodType(node: ts.Node, sourceFile: ts.SourceFile): {
    type: AnalyzedType;
    validation?: ValidationConstraints;
    description?: string;
  } {
    const current = this.unwrapCall(node as ts.CallExpression);
    const chain = this.collectChain(node);

    // Resolve variable references at the start of the chain, e.g. const name = z.string();
    if (ts.isIdentifier(current) && chain.length === 0) {
      const init = this.resolveIdentifierInitializer(current, sourceFile);
      if (init) return this.analyzeZodType(init, sourceFile);
    }

    const constraints: ValidationConstraints = {};
    let description: string | undefined;
    let baseType: AnalyzedType = { type: 'any', isArray: false, isOptional: false };
    let optional = false;
    let nullable = false;
    let defaultValue: unknown | undefined;

    // The chain is read left-to-right: z.string().email().min(5)
    for (let i = 0; i < chain.length; i++) {
      const call = chain[i];
      const methodName = this.getMethodName(call) || '';
      const args = call.arguments.map(a => this.literalValue(a));

      if (i === 0) {
        baseType = this.baseTypeFromMethod(methodName, call, sourceFile);
        continue;
      }

      switch (methodName) {
        case 'optional':
          optional = true;
          break;
        case 'nullable':
          nullable = true;
          break;
        case 'default':
        case 'catch':
          if (args.length > 0) defaultValue = args[0];
          optional = true;
          break;
        case 'describe':
          if (args.length > 0 && typeof args[0] === 'string') description = args[0];
          break;
        case 'min':
          if (baseType.type === 'string') {
            constraints.minLength = this.numericArg(args, 0);
          } else if (baseType.type === 'number' || baseType.type === 'integer') {
            constraints.minimum = this.numericArg(args, 0);
          }
          break;
        case 'max':
          if (baseType.type === 'string') {
            constraints.maxLength = this.numericArg(args, 0);
          } else if (baseType.type === 'number' || baseType.type === 'integer') {
            constraints.maximum = this.numericArg(args, 0);
          }
          break;
        case 'length':
          constraints.minLength = this.numericArg(args, 0);
          constraints.maxLength = this.numericArg(args, 0);
          break;
        case 'email':
          constraints.format = 'email';
          baseType.type = 'string';
          break;
        case 'url':
          constraints.format = 'url';
          baseType.type = 'string';
          break;
        case 'uuid':
          constraints.format = 'uuid';
          baseType.type = 'string';
          break;
        case 'datetime':
          constraints.format = 'date-time';
          baseType.type = 'string';
          break;
        case 'regex':
          constraints.format = 'regex';
          baseType.type = 'string';
          break;
        case 'nonempty':
        case 'nonEmpty':
          constraints.minLength = 1;
          baseType.type = 'string';
          break;
        case 'array':
          baseType = this.analyzeZodType(call.arguments[0], sourceFile).type;
          baseType = { ...baseType, isArray: true };
          break;
      }
    }

    if (optional || defaultValue !== undefined) baseType.isOptional = true;
    if (nullable) {
      if (!baseType.unionTypes) baseType.unionTypes = [];
      baseType.unionTypes.push('null');
    }
    if (defaultValue !== undefined) baseType.example = defaultValue;

    return { type: baseType, validation: Object.keys(constraints).length ? constraints : undefined, description };
  }

  private baseTypeFromMethod(methodName: string, call: ts.CallExpression, sourceFile: ts.SourceFile): AnalyzedType {
    switch (methodName) {
      case 'string':
      case 'email':
      case 'url':
      case 'uuid':
      case 'datetime':
      case 'regex':
      case 'nonempty':
      case 'nonEmpty':
        return { type: 'string', isArray: false, isOptional: false };
      case 'number':
      case 'coerce':
        return { type: 'number', isArray: false, isOptional: false };
      case 'bigint':
        return { type: 'integer', isArray: false, isOptional: false };
      case 'boolean':
        return { type: 'boolean', isArray: false, isOptional: false };
      case 'date':
        return { type: 'string', isArray: false, isOptional: false, format: 'date-time' };
      case 'literal':
        return { type: 'string', isArray: false, isOptional: false, enumValues: [String(this.literalValue(call.arguments[0]))] };
      case 'enum':
      case 'nativeEnum':
        return this.analyzeEnum(call);
      case 'array':
        if (call.arguments.length > 0) {
          const item = this.analyzeZodType(call.arguments[0], sourceFile).type;
          return { ...item, isArray: true };
        }
        return { type: 'any', isArray: true, isOptional: false };
      case 'object':
        return { type: 'object', isArray: false, isOptional: false, properties: this.extractShape(call, sourceFile) || [] };
      case 'record':
        return { type: 'object', isArray: false, isOptional: false };
      case 'union':
        return this.analyzeUnion(call, sourceFile);
      case 'any':
      case 'unknown':
      default:
        return { type: 'any', isArray: false, isOptional: false };
    }
  }

  private analyzeEnum(call: ts.CallExpression): AnalyzedType {
    const arg = call.arguments[0];
    if (!arg) return { type: 'string', isArray: false, isOptional: false };
    const values: string[] = [];
    if (ts.isArrayLiteralExpression(arg)) {
      for (const elem of arg.elements) {
        const v = this.literalValue(elem);
        if (v !== undefined) values.push(String(v));
      }
    } else if (ts.isObjectLiteralExpression(arg)) {
      for (const prop of arg.properties) {
        if (ts.isPropertyAssignment(prop) && prop.name) values.push(this.propertyNameText(prop.name) || '');
      }
    }
    return { type: 'string', isArray: false, isOptional: false, enumValues: values.length ? values : undefined };
  }

  private analyzeUnion(call: ts.CallExpression, sourceFile: ts.SourceFile): AnalyzedType {
    const arg = call.arguments[0];
    if (!arg || !ts.isArrayLiteralExpression(arg)) return { type: 'any', isArray: false, isOptional: false };
    const unionTypes: string[] = [];
    const enumValues: string[] = [];
    let properties: PropertyInfo[] | undefined;
    for (const elem of arg.elements) {
      const result = this.analyzeZodType(elem, sourceFile).type;
      unionTypes.push(result.type);
      if (result.enumValues) enumValues.push(...result.enumValues);
      if (result.properties && !properties) properties = result.properties;
    }
    return { type: 'any', isArray: false, isOptional: false, unionTypes, enumValues: enumValues.length ? enumValues : undefined, properties };
  }

  private collectChain(node: ts.Node): ts.CallExpression[] {
    const chain: ts.CallExpression[] = [];
    let current: ts.Node = node;
    while (current && ts.isCallExpression(current)) {
      chain.unshift(current);
      if (ts.isPropertyAccessExpression(current.expression)) {
        current = current.expression.expression;
      } else {
        break;
      }
    }
    return chain;
  }

  private unwrapCall(node: ts.Node): ts.CallExpression {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      return node;
    }
    return node as ts.CallExpression;
  }

  private isCallExpressionNamed(node: ts.Node, name: string): boolean {
    if (!ts.isCallExpression(node)) return false;
    return this.getMethodName(node) === name || this.getRootName(node) === name;
  }

  private getMethodName(call: ts.CallExpression): string | undefined {
    if (ts.isPropertyAccessExpression(call.expression)) {
      return call.expression.name.getText();
    }
    if (ts.isIdentifier(call.expression)) {
      return call.expression.getText();
    }
    return undefined;
  }

  private getRootName(call: ts.CallExpression): string | undefined {
    if (ts.isPropertyAccessExpression(call.expression)) {
      let expr: ts.Expression = call.expression.expression;
      while (ts.isPropertyAccessExpression(expr) || ts.isCallExpression(expr)) {
        expr = ts.isPropertyAccessExpression(expr) ? expr.expression : expr.expression;
      }
      return ts.isIdentifier(expr) ? expr.getText() : undefined;
    }
    return ts.isIdentifier(call.expression) ? call.expression.getText() : undefined;
  }

  private resolveIdentifierInitializer(identifier: ts.Node, sourceFile: ts.SourceFile): ts.Node | null {
    if (!ts.isIdentifier(identifier)) return null;
    const name = identifier.getText();
    for (const statement of sourceFile.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const decl of statement.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.getText() === name) {
            return decl.initializer || null;
          }
        }
      }
    }
    return null;
  }

  private propertyNameText(name: ts.PropertyName): string | null {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }
    if (ts.isComputedPropertyName(name)) {
      const v = this.literalValue(name.expression);
      return v !== undefined ? String(v) : null;
    }
    return null;
  }

  private literalValue(node: ts.Node): unknown {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isIdentifier(node) && node.getText() === 'undefined') return undefined;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(e => this.literalValue(e));
    if (ts.isObjectLiteralExpression(node)) {
      const obj: Record<string, unknown> = {};
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p)) {
          const key = this.propertyNameText(p.name);
          if (key) obj[key] = this.literalValue(p.initializer);
        }
      }
      return obj;
    }
    return undefined;
  }

  private numericArg(args: unknown[], index: number): number | undefined {
    const v = args[index];
    return typeof v === 'number' ? v : undefined;
  }
}
