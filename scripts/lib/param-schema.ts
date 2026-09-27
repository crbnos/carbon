/**
 * Input-side reflection of every exported service function's parameters, read
 * from the TypeScript checker.
 *
 * `service-metadata.ts` builds each tool's input schema by parsing the parameter
 * list as text. Text cannot see what the compiler knows: that a param with an
 * initializer (`quantity: number = 1`) or a `T | undefined` type may be left out,
 * what a named type (`job: Job`, `options: AgingOptions`) contains, or which
 * members a `GenericQueryFilters` intersection carries. This module answers those
 * questions from the checker, and the manifest builder uses the answers where the
 * text is silent or wrong:
 *
 * - optionality of every non-context param, and of each field of a param whose
 *   fields are flattened into the schema;
 * - the literal default of a param with an initializer;
 * - a typed schema where the textual path publishes `{}`;
 * - the flattened shape of a `GenericQueryFilters` param, and whether the
 *   service honours its `filters` / `sorts`;
 * - `@param` descriptions.
 *
 * Everything the textual path already resolves is left to it, so this does not
 * churn the hundreds of schemas it gets right. `findCheckerDisagreements` lists
 * where the two still differ.
 */

import * as path from "path";
import {
  type CallExpression,
  type FunctionDeclaration,
  Node,
  type ParameterDeclaration,
  SyntaxKind,
  type Type
} from "ts-morph";
import {
  admitsUndefined,
  isJsonAlias,
  isOptionalProperty,
  type JsonSchema,
  loadServiceProject,
  type ServiceProject,
  typeToJsonSchema
} from "./response-schema";
import { CONTEXT_PARAMS } from "./validator-registry";

const ROOT = path.resolve(__dirname, "../..");
const QUERY_UTILS = path.join(ROOT, "apps/erp/app/utils/query.ts");

/** The members `GenericQueryFilters` itself declares. */
export const GENERIC_QUERY_FILTER_KEYS = new Set([
  "limit",
  "offset",
  "sorts",
  "filters"
]);

export interface CheckedField {
  /** Optional on the wire: `?`, or a type that admits undefined. */
  optional: boolean;
  /** any / unknown / Json — an open value by design. */
  opaque: boolean;
  schema: JsonSchema;
}

/** How a service uses its `GenericQueryFilters` param. */
export interface GenericQueryFiltersUsage {
  /** The param reaches `setGenericQueryFilters`, or its `.limit` is read. */
  paging: boolean;
  /** The param's `filters` reach `setGenericQueryFilters` / `getGenericFilter`. */
  filters: boolean;
  /** The param's `sorts` reach `setGenericQueryFilters`, or are read directly. */
  sorts: boolean;
}

export interface CheckedParam {
  /** The declared name; a destructuring pattern keeps its source text. */
  name: string;
  isContext: boolean;
  /** Rule: `?`, an initializer, or a type that admits undefined. */
  optional: boolean;
  /** True when the param has an initializer. */
  hasInitializer: boolean;
  /** The initializer's value, when it is a JSON literal. */
  default?: unknown;
  /** `@param` tag text for this param. */
  description?: string;
  /** `@param name.field` tag text, per field. */
  fieldDescriptions: Record<string, string>;
  /** any / unknown / Json. */
  opaque: boolean;
  /** The declared type goes through a zod validator (`z.infer<…>`). */
  usesValidator: boolean;
  /** Input-mode schema of the param's type (undefined stripped). */
  schema: JsonSchema;
  /** The fields of an object-typed param, for flattened schemas. */
  fields: Record<string, CheckedField> | null;
  /** Set when the param is typed with `GenericQueryFilters`. */
  genericQueryFilters: null | {
    /** The intersection's own members (search, status, …), none of them required. */
    members: Record<string, CheckedField>;
    usage: GenericQueryFiltersUsage;
    /** Input schemas of one `Filter` and one `Sort`, from the checker. */
    filterItem: JsonSchema;
    sortItem: JsonSchema;
  };
}

export interface ParamSchemaIndex {
  /** Params of `{module}_{fn}` in declaration order, or null when not found. */
  get(module: string, functionName: string): CheckedParam[] | null;
  /** The operators `getGenericFilter` accepts, read from its switch. */
  readonly filterOperators: string[];
}

const INPUT = { input: true } as const;

function inputSchema(type: Type, at: Node): JsonSchema {
  return typeToJsonSchema(type, at, 0, new Set(), INPUT);
}

function isOpaque(type: Type): boolean {
  if (type.isAny() || type.isUnknown() || isJsonAlias(type)) return true;
  const t = type.getNonNullableType();
  return t.isAny() || t.isUnknown() || isJsonAlias(t);
}

/** The literal value of an initializer, when it is expressible as JSON. */
function literalValue(node: Node | undefined): { value: unknown } | null {
  if (!node) return null;
  if (Node.isNumericLiteral(node)) return { value: node.getLiteralValue() };
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return { value: node.getLiteralValue() };
  }
  if (Node.isTrueLiteral(node)) return { value: true };
  if (Node.isFalseLiteral(node)) return { value: false };
  if (Node.isNullLiteral(node)) return { value: null };
  if (
    Node.isPrefixUnaryExpression(node) &&
    node.getOperatorToken() === SyntaxKind.MinusToken
  ) {
    const operand = node.getOperand();
    if (Node.isNumericLiteral(operand)) {
      return { value: -operand.getLiteralValue() };
    }
  }
  if (Node.isArrayLiteralExpression(node) && node.getElements().length === 0) {
    return { value: [] };
  }
  if (
    Node.isObjectLiteralExpression(node) &&
    node.getProperties().length === 0
  ) {
    return { value: {} };
  }
  return null;
}

/**
 * The fields of an object type, for input: a field is optional when any union
 * member lacks it, marks it `?`, or types it with undefined. Null for arrays,
 * index-signature maps and non-objects.
 */
function objectFields(
  type: Type,
  at: Node
): Record<string, CheckedField> | null {
  const t = type.getNonNullableType();
  const members = t.isUnion() ? t.getUnionTypes() : [t];
  if (
    members.length === 0 ||
    members.some(
      (m) =>
        !(m.isObject() || m.isIntersection()) ||
        m.isArray() ||
        m.getStringIndexType() !== undefined ||
        m.getSymbol()?.getName() === "Date"
    )
  ) {
    return null;
  }

  const fields: Record<string, CheckedField> = {};
  const names = new Set<string>();
  for (const m of members) {
    for (const p of m.getProperties()) {
      if (!p.getName().startsWith("__@")) names.add(p.getName());
    }
  }
  for (const name of names) {
    let optional = false;
    let first: Type | undefined;
    for (const m of members) {
      const p = m.getProperty(name);
      if (!p) {
        optional = true;
        continue;
      }
      const pt = p.getTypeAtLocation(at);
      first ??= pt;
      if (isOptionalProperty(p, pt)) optional = true;
    }
    if (!first) continue;
    fields[name] = {
      optional,
      opaque: isOpaque(first),
      schema: inputSchema(first, at)
    };
  }
  return fields;
}

function isGenericQueryFiltersType(type: Type): boolean {
  const t = type.getNonNullableType();
  const parts = t.isIntersection() ? t.getIntersectionTypes() : [t];
  return parts.some(
    (p) =>
      p.getSymbol()?.getName() === "GenericQueryFilters" ||
      p.getAliasSymbol()?.getName() === "GenericQueryFilters"
  );
}

/** Does `arg` hand the param named `name` on, as is (`name`, `name ?? {}`, `{ ...name }`)? */
function passesParam(arg: Node, name: string): boolean {
  if (Node.isIdentifier(arg)) return arg.getText() === name;
  if (Node.isParenthesizedExpression(arg)) {
    return passesParam(arg.getExpression(), name);
  }
  if (Node.isBinaryExpression(arg)) {
    const op = arg.getOperatorToken().getKind();
    if (
      op === SyntaxKind.QuestionQuestionToken ||
      op === SyntaxKind.BarBarToken
    ) {
      return passesParam(arg.getLeft(), name);
    }
    return false;
  }
  if (Node.isObjectLiteralExpression(arg)) {
    return arg
      .getProperties()
      .some(
        (p) =>
          Node.isSpreadAssignment(p) && passesParam(p.getExpression(), name)
      );
  }
  return false;
}

/** Names an object-literal argument sets explicitly (`{ ...args, filters: x }`). */
function explicitKeys(arg: Node): Set<string> {
  const keys = new Set<string>();
  if (!Node.isObjectLiteralExpression(arg)) return keys;
  for (const p of arg.getProperties()) {
    if (Node.isPropertyAssignment(p) || Node.isShorthandPropertyAssignment(p)) {
      keys.add(p.getName());
    }
  }
  return keys;
}

function calleeFunction(call: CallExpression): FunctionDeclaration | null {
  let symbol = call.getExpression().getSymbol();
  if (!symbol) return null;
  if (symbol.isAlias()) symbol = symbol.getAliasedSymbol() ?? symbol;
  for (const decl of symbol.getDeclarations()) {
    if (Node.isFunctionDeclaration(decl) && decl.getBody()) return decl;
  }
  return null;
}

const NO_USAGE: GenericQueryFiltersUsage = {
  paging: false,
  filters: false,
  sorts: false
};

/**
 * Trace where a service sends its `GenericQueryFilters` param: straight into
 * `setGenericQueryFilters`, through another function that does (`getPeople` →
 * `getEmployees`), or read field by field. Memoized per function and position.
 */
function genericQueryFiltersUsage(
  fn: FunctionDeclaration,
  index: number,
  memo: Map<string, GenericQueryFiltersUsage>
): GenericQueryFiltersUsage {
  const key = `${fn.getSourceFile().getFilePath()}:${fn.getStart()}:${index}`;
  const cached = memo.get(key);
  if (cached) return cached;
  memo.set(key, NO_USAGE); // cycle guard

  const param = fn.getParameters()[index];
  const body = fn.getBody();
  if (!param || !body || !Node.isIdentifier(param.getNameNode())) {
    return NO_USAGE;
  }
  const name = param.getName();
  const text = body.getText();
  const reads = (field: string) =>
    new RegExp(`\\b${name}\\??\\.${field}\\b`).test(text);

  const usage: GenericQueryFiltersUsage = {
    paging: reads("limit"),
    filters: reads("filters") && /\bgetGenericFilter\s*\(/.test(text),
    sorts: reads("sorts")
  };

  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const args = call.getArguments();
    const callee = call.getExpression().getText();
    if (callee === "setGenericQueryFilters") {
      const arg = args[1];
      if (!arg || !passesParam(arg, name)) continue;
      const overridden = explicitKeys(arg);
      usage.paging = true;
      // `{ ...args, filters: narrowed }` still honours the caller's filters
      // when the replacement is derived from them.
      if (!overridden.has("filters") || reads("filters")) usage.filters = true;
      if (!overridden.has("sorts") || reads("sorts")) usage.sorts = true;
      continue;
    }
    const position = args.findIndex((a) => passesParam(a, name));
    if (position === -1) continue;
    const target = calleeFunction(call);
    if (!target) continue;
    const inner = genericQueryFiltersUsage(target, position, memo);
    usage.paging ||= inner.paging;
    usage.filters ||= inner.filters;
    usage.sorts ||= inner.sorts;
  }

  memo.set(key, usage);
  return usage;
}

/** `@param` tag text by name, including dotted field tags (`update.assignee`). */
function paramTags(fn: FunctionDeclaration): Map<string, string> {
  const tags = new Map<string, string>();
  for (const doc of fn.getJsDocs()) {
    for (const tag of doc.getTags()) {
      if (!Node.isJSDocParameterTag(tag)) continue;
      const comment = tag
        .getCommentText()
        ?.replace(/^\s*-\s*/, "")
        .replace(/\s+/g, " ")
        .trim();
      if (comment) tags.set(tag.getName(), comment);
    }
  }
  return tags;
}

function checkParam(
  fn: FunctionDeclaration,
  param: ParameterDeclaration,
  index: number,
  tags: Map<string, string>,
  memo: Map<string, GenericQueryFiltersUsage>
): CheckedParam {
  const name = param.getName();
  const isContext = CONTEXT_PARAMS.has(name);
  const type = param.getType();
  const initializer = param.getInitializer();
  const literal = literalValue(initializer);
  const typeText = param.getTypeNode()?.getText() ?? "";

  const fieldDescriptions: Record<string, string> = {};
  for (const [tagName, text] of tags) {
    if (tagName.startsWith(`${name}.`)) {
      fieldDescriptions[tagName.slice(name.length + 1)] = text;
    }
  }

  let genericQueryFilters: CheckedParam["genericQueryFilters"] = null;
  if (!isContext && isGenericQueryFiltersType(type)) {
    const t = type.getNonNullableType();
    const members: Record<string, CheckedField> = {};
    for (const [field, info] of Object.entries(objectFields(t, param) ?? {})) {
      if (GENERIC_QUERY_FILTER_KEYS.has(field)) continue;
      // Services read these with truthiness checks (`if (args.search)`) or a
      // fallback (`args.isMetric ?? false`), so none is required on the wire.
      members[field] = { ...info, optional: true };
    }
    const itemOf = (field: string) => {
      const p = t.getProperty(field);
      const pt = p?.getTypeAtLocation(param).getNonNullableType();
      const element = pt?.isArray() ? pt.getArrayElementType() : undefined;
      return element ? inputSchema(element, param) : { type: "object" };
    };
    genericQueryFilters = {
      members,
      usage: genericQueryFiltersUsage(fn, index, memo),
      filterItem: itemOf("filters"),
      sortItem: itemOf("sorts")
    };
  }

  let schema: JsonSchema | undefined;
  let fields: Record<string, CheckedField> | null | undefined;
  return {
    name,
    isContext,
    optional:
      param.hasQuestionToken() ||
      initializer !== undefined ||
      (!isContext && admitsUndefined(type)),
    hasInitializer: initializer !== undefined,
    ...(literal ? { default: literal.value } : {}),
    description: tags.get(name),
    fieldDescriptions,
    opaque: !isContext && isOpaque(type),
    // A param whose type IS a validator (bare, wrapped or composed). An inline
    // object that merely has a validator-typed FIELD is not one.
    usesValidator:
      /\bz\.infer\s*</.test(typeText) && !typeText.trimStart().startsWith("{"),
    // Walked on first read: the generator asks for these only where the
    // textual schema needs them, and a context param (a whole Supabase client
    // type) must never be walked at all.
    get schema() {
      // The input walk drops undefined itself; null stays (a nullable value).
      schema ??= isContext ? {} : inputSchema(type, param);
      return schema;
    },
    get fields() {
      if (fields === undefined) {
        fields = isContext ? null : objectFields(type, param);
      }
      return fields;
    },
    genericQueryFilters
  };
}

/** The string cases of `getGenericFilter`'s operator switch, in source order. */
function readFilterOperators(loaded: ServiceProject): string[] {
  const source =
    loaded.project.getSourceFile(QUERY_UTILS) ??
    loaded.project.addSourceFileAtPath(QUERY_UTILS);
  const fn = source.getFunction("getGenericFilter");
  if (!fn) throw new Error("getGenericFilter not found in utils/query.ts");
  const operators = fn
    .getDescendantsOfKind(SyntaxKind.CaseClause)
    .map((c) => c.getExpression())
    .filter(Node.isStringLiteral)
    .map((e) => e.getLiteralValue());
  if (operators.length === 0) {
    throw new Error("getGenericFilter declares no operator cases");
  }
  return operators;
}

/**
 * Reflect every module's exported service functions' parameters. Pass the
 * project the response reflection already loaded to avoid a second load.
 */
export function buildParamSchemaIndex(
  modules: readonly string[],
  loaded: ServiceProject = loadServiceProject(modules)
): ParamSchemaIndex {
  const byTool = new Map<string, CheckedParam[]>();
  const memo = new Map<string, GenericQueryFiltersUsage>();

  // Later sources win: a `.mcp.server.ts` export shadows the service function
  // of the same name, as in the generator and the runtime registry.
  for (const { mod, source } of loaded.sources) {
    for (const fn of source.getFunctions()) {
      if (!fn.isExported() || fn.isOverload()) continue;
      const name = fn.getName();
      if (!name) continue;
      const tags = paramTags(fn);
      byTool.set(
        `${mod}_${name}`,
        fn
          .getParameters()
          .map((param, index) => checkParam(fn, param, index, tags, memo))
      );
    }
  }

  const filterOperators = readFilterOperators(loaded);

  return {
    get(module, functionName) {
      return byTool.get(`${module}_${functionName}`) ?? null;
    },
    filterOperators
  };
}
