/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import * as ts from 'typescript';

/**
 * Shared helpers for reading decorators, literals and JSDoc off raw
 * TypeScript AST nodes. These cover the handful of ts-morph conveniences the
 * scanner relied on.
 */

/** The decorators applied to a node, or an empty array. */
export function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

/** The call expression of a decorator written as `@Name(...)`. */
export function getDecoratorCall(decorator: ts.Decorator): ts.CallExpression | undefined {
  return ts.isCallExpression(decorator.expression) ? decorator.expression : undefined;
}

/** The identifier name of a decorator, for both `@Name` and `@Name(...)`. */
export function getDecoratorName(decorator: ts.Decorator): string | undefined {
  const call = getDecoratorCall(decorator);
  const expression = call ? call.expression : decorator.expression;
  return ts.isIdentifier(expression) ? expression.text : undefined;
}

/** The arguments of a decorator call, or an empty array. */
export function getDecoratorArguments(decorator: ts.Decorator): readonly ts.Expression[] {
  return getDecoratorCall(decorator)?.arguments ?? [];
}

/** The numeric value of a literal, handling `-1` prefix expressions. */
export function numericLiteralValue(node: ts.Node): number | undefined {
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    const value = Number(node.operand.text);
    return node.operator === ts.SyntaxKind.MinusToken ? -value : value;
  }
  return undefined;
}

/** The value of a string literal node, if it is one. */
export function stringLiteralValue(node: ts.Node): string | undefined {
  return staticString(node);
}

/**
 * The type checker of the program being scanned. Set by TsProject whenever a
 * checker is handed out, so every decorator reader can resolve constants
 * without threading the checker through each call.
 */
let activeChecker: ts.TypeChecker | undefined;

export function setStaticChecker(checker: ts.TypeChecker | undefined): void {
  activeChecker = checker;
}

const MAX_DEPTH = 12;

/**
 * The compile-time string value of an expression, or `undefined` when it is
 * only known at runtime.
 *
 * Decorator arguments are often constants rather than literals —
 * `@SubscribeMessage(EVENTS.JOIN)`, `@Controller(ROUTES.USERS)`,
 * `@WebSocketGateway({ namespace: NS })`. Reading only literals silently
 * dropped those handlers and routes. Resolved here: string/template literals,
 * `+` concatenation, template expressions, const variables (also imported or
 * re-exported), object properties (with or without `as const`), element
 * access with a literal key, string enum members, static readonly class
 * fields, and anything the checker types as a single string literal.
 */
export function staticString(node: ts.Node | undefined, depth = 0): string | undefined {
  const value = staticValue(node, depth);
  return typeof value === 'string' ? value : undefined;
}

/** Like {@link staticString}, but also numbers — for template spans and versions. */
export function staticValue(node: ts.Node | undefined, depth = 0): string | number | undefined {
  if (!node || depth > MAX_DEPTH) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)
    || ts.isTypeAssertionExpression(node) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(node))) {
    return staticValue(node.expression, depth + 1);
  }
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const part = staticValue(span.expression, depth + 1);
      if (part === undefined) return undefined;
      out += String(part) + span.literal.text;
    }
    return out;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticValue(node.left, depth + 1);
    const right = staticValue(node.right, depth + 1);
    if (left === undefined || right === undefined) return undefined;
    return typeof left === 'number' && typeof right === 'number' ? left + right : String(left) + String(right);
  }

  const checker = activeChecker;
  if (!checker) return undefined;

  // `as const` objects, const variables and string enums are typed as literals.
  try {
    const type = checker.getTypeAtLocation(node);
    if (type.isStringLiteral()) return type.value;
    if (type.isNumberLiteral()) return type.value;
  } catch {
    /* nodes from a different program: fall through to the declaration */
  }

  // Otherwise follow the symbol to its declaration: `const X = { A: 'a' }`.
  if (ts.isElementAccessExpression(node)) {
    const key = staticValue(node.argumentExpression, depth + 1);
    const object = staticObject(node.expression, depth + 1);
    if (key === undefined || !object) return undefined;
    return staticValue(objectPropertyInitializerByName(object, String(key)), depth + 1);
  }
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
    const symbol = resolvedSymbol(checker, ts.isPropertyAccessExpression(node) ? node.name : node);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    if (!declaration) return undefined;
    if (ts.isEnumMember(declaration)) {
      const constant = checker.getConstantValue(declaration);
      return constant === undefined ? undefined : constant;
    }
    return staticValue(constantInitializer(declaration), depth + 1);
  }
  return undefined;
}

/** Every element of a string array expression, when all of them are static. */
export function staticStringArray(node: ts.Node | undefined, depth = 0): string[] | undefined {
  if (!node || depth > MAX_DEPTH) return undefined;
  const single = staticValue(node, depth);
  if (single !== undefined) return [String(single)];
  let target: ts.Node | undefined = node;
  while (target && (ts.isParenthesizedExpression(target) || ts.isAsExpression(target))) target = target.expression;
  if (target && !ts.isArrayLiteralExpression(target) && activeChecker && (ts.isIdentifier(target) || ts.isPropertyAccessExpression(target))) {
    const symbol = resolvedSymbol(activeChecker, ts.isPropertyAccessExpression(target) ? target.name : target);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    target = declaration ? constantInitializer(declaration) : undefined;
    while (target && (ts.isParenthesizedExpression(target) || ts.isAsExpression(target))) target = target.expression;
  }
  if (!target || !ts.isArrayLiteralExpression(target)) return undefined;
  const values: string[] = [];
  for (const element of target.elements) {
    const value = staticValue(element, depth + 1);
    if (value === undefined) return undefined;
    values.push(String(value));
  }
  return values;
}

function resolvedSymbol(checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
    try { symbol = checker.getAliasedSymbol(symbol); } catch { /* keep the alias */ }
  }
  return symbol;
}

/** The value expression behind a declaration that cannot change at runtime. */
function constantInitializer(declaration: ts.Declaration): ts.Expression | undefined {
  if (ts.isVariableDeclaration(declaration)) {
    const isConst = (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0;
    return isConst ? declaration.initializer : undefined;
  }
  if (ts.isPropertyAssignment(declaration)) return declaration.initializer;
  if (ts.isShorthandPropertyAssignment(declaration) && activeChecker) {
    const target = activeChecker.getShorthandAssignmentValueSymbol(declaration);
    const decl = target?.valueDeclaration;
    return decl ? constantInitializer(decl) : undefined;
  }
  if (ts.isPropertyDeclaration(declaration)) {
    const modifiers = ts.getCombinedModifierFlags(declaration);
    const fixed = (modifiers & ts.ModifierFlags.Readonly) !== 0 && (modifiers & ts.ModifierFlags.Static) !== 0;
    return fixed ? declaration.initializer : undefined;
  }
  return undefined;
}

/** The object literal an expression refers to, following const variables and nested properties. */
function staticObject(node: ts.Node, depth: number): ts.ObjectLiteralExpression | undefined {
  if (depth > MAX_DEPTH) return undefined;
  let target: ts.Node | undefined = node;
  while (target && (ts.isParenthesizedExpression(target) || ts.isAsExpression(target) || ts.isNonNullExpression(target))) target = target.expression;
  if (!target) return undefined;
  if (ts.isObjectLiteralExpression(target)) return target;
  if (!activeChecker) return undefined;
  if (ts.isIdentifier(target) || ts.isPropertyAccessExpression(target)) {
    const symbol = resolvedSymbol(activeChecker, ts.isPropertyAccessExpression(target) ? target.name : target);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    const init = declaration ? constantInitializer(declaration) : undefined;
    return init ? staticObject(init, depth + 1) : undefined;
  }
  return undefined;
}

function objectPropertyInitializerByName(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name)
      ? prop.name.text : undefined;
    if (key === name) return prop.initializer;
  }
  return undefined;
}

/** The initializer of a `name: value` property inside an object literal. */
export function objectPropertyInitializer(
  obj: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && prop.name.getText() === name) {
      return prop.initializer;
    }
  }
  return undefined;
}

export interface JsDocInfo {
  /** Full description text, before any tags. */
  description?: string;
  deprecated?: boolean;
}

/** Reads the JSDoc description and `@deprecated` tag off a node. */
export function getJsDocInfo(node: ts.Node): JsDocInfo {
  const jsDocs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
  if (jsDocs.length === 0) {
    return {};
  }

  const deprecated = jsDocs.some((doc) =>
    (doc.tags ?? []).some((tag) => tag.tagName.text === 'deprecated'),
  );

  const comment = jsDocs[0].comment;
  const description =
    typeof comment === 'string' ? comment : (ts.getTextOfJSDocComment(comment) ?? '');

  return {
    description: description.trim() || undefined,
    deprecated: deprecated || undefined,
  };
}
