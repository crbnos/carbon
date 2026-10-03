// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The service files as an AST: which functions a module publishes, what their
 * parameters and doc tags are, and what their bodies do to the database.
 *
 * Everything here used to be read off the files' TEXT, and each text reader had
 * its own way of being wrong:
 *
 *  - Functions were found with `/export\s+(async\s+)?function\s+(\w+)\s*\(/`, so an
 *    exported ARROW function was invisible (`production.getPartDocuments`).
 *  - A function's body ran "from its name to the next `\nexport `", so a
 *    non-exported helper defined below it was read as part of it, and a
 *    `mcp.server.ts` wrapper was scanned as the service function it shadows.
 *  - "Does it delete" was `/\.delete\s*\(/`, which a `Set#delete` satisfies
 *    (`production.reassignAssemblyStepComponents` calls `members.delete(…)`).
 *  - Doc tags were regexes over the comment's lines, and the script that wrote
 *    them mis-spliced single-line blocks three separate ways.
 *
 * One ts-morph `Project` is built here and shared with `response-schema.ts`,
 * which reflects return types over the same files.
 */
import * as fs from "fs";
import * as path from "path";
import {
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type JSDoc,
  Node,
  type ParameterDeclaration,
  Project,
  type SourceFile,
  type Symbol as MorphSymbol,
  SymbolFlags,
  SyntaxKind
} from "ts-morph";

const ROOT = path.resolve(__dirname, "../..");
const ERP_ROOT = path.join(ROOT, "apps/erp");
const MODULES_DIR = path.join(ERP_ROOT, "app/modules");

export type ServiceFunctionNode =
  | FunctionDeclaration
  | ArrowFunction
  | FunctionExpression;

export interface ServiceParam {
  name: string;
  /** The declared type's source text, comments removed. */
  typeStr: string;
  optional: boolean;
  description?: string;
  /** `...rest` — a variadic tail has no JSON-object representation. */
  rest: boolean;
}

export interface ServiceTag {
  /** Tag name without the `@`. */
  name: string;
  comment: string;
}

export interface ServiceFunction {
  module: string;
  name: string;
  /** `{module}_{name}` — the published operation name. */
  toolName: string;
  node: ServiceFunctionNode;
  params: ServiceParam[];
  /** Raw body of the JSDoc block attached to the declaration, if any. */
  jsdoc?: string;
  tags: ServiceTag[];
}

export interface ServiceModule {
  /** Published functions in source order; a companion's shadow replaces in place. */
  functions: ServiceFunction[];
  /** Source text of the module's service file(s), for alias lookups by text. */
  text: string;
}

export interface ServiceAst {
  readonly project: Project;
  readonly modules: ReadonlyMap<string, ServiceModule>;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Source text of `node` with every comment inside it removed. */
function textWithoutComments(node: Node): string {
  const start = node.getStart();
  const text = node.getText();
  const cuts: [number, number][] = [];
  const collect = (n: Node) => {
    for (const range of [
      ...n.getLeadingCommentRanges(),
      ...n.getTrailingCommentRanges()
    ]) {
      const from = range.getPos() - start;
      const to = range.getEnd() - start;
      if (from >= 0 && to <= text.length) cuts.push([from, to]);
    }
  };
  collect(node);
  // getDescendants() includes TOKENS; a comment before a closing brace is the
  // leading trivia of that token and of no node.
  for (const descendant of node.getDescendants()) collect(descendant);
  if (cuts.length === 0) return text;

  cuts.sort((a, b) => a[0] - b[0]);
  let out = "";
  let cursor = 0;
  for (const [from, to] of cuts) {
    if (from < cursor) continue;
    out += text.slice(cursor, from);
    cursor = to;
  }
  return out + text.slice(cursor);
}

/** The body of a `/** … *\/` block as prose: leading `*` gutters dropped. */
function docCommentProse(body: string): string | undefined {
  return (
    body
      .split("\n")
      .map((line) => line.replace(/^\s*\*?\s?/, "").trim())
      .join(" ")
      .trim() || undefined
  );
}

function typeOfDefault(initializer: Node): string {
  if (
    Node.isTrueLiteral(initializer) ||
    Node.isFalseLiteral(initializer)
  ) {
    return "boolean";
  }
  if (Node.isNumericLiteral(initializer)) return "number";
  if (
    Node.isPrefixUnaryExpression(initializer) &&
    Node.isNumericLiteral(initializer.getOperand())
  ) {
    return "number";
  }
  if (
    Node.isStringLiteral(initializer) ||
    Node.isNoSubstitutionTemplateLiteral(initializer) ||
    Node.isTemplateExpression(initializer)
  ) {
    return "string";
  }
  return "unknown";
}

function readParam(
  param: ParameterDeclaration,
  existing: ServiceParam[]
): ServiceParam {
  const nameNode = param.getNameNode();
  // A destructuring pattern is not a name. Its source text put braces and
  // newlines into the manifest, so reformatting a signature churned the digest;
  // the synthetic name only has to avoid CONTEXT_PARAMS and the dispatcher's
  // `args` branch — nothing else reads a param name for meaning.
  let name = nameNode.getText();
  if (
    Node.isObjectBindingPattern(nameNode) ||
    Node.isArrayBindingPattern(nameNode)
  ) {
    name = "destructured";
    for (let i = 2; existing.some((p) => p.name === name); i++) {
      name = `destructured${i}`;
    }
  }

  const typeNode = param.getTypeNode();
  const initializer = param.getInitializer();
  const leadingDoc = param
    .getLeadingCommentRanges()
    .map((range) => range.getText())
    .filter((text) => text.startsWith("/**"))
    .pop();

  return {
    name,
    typeStr: typeNode
      ? textWithoutComments(typeNode).trim()
      : initializer
        ? typeOfDefault(initializer)
        : "unknown",
    optional: param.hasQuestionToken() || initializer !== undefined,
    description: leadingDoc
      ? docCommentProse(leadingDoc.slice(3, -2))
      : undefined,
    rest: param.isRestParameter()
  };
}

function readTags(doc: JSDoc): ServiceTag[] {
  return doc.getTags().map((tag) => ({
    name: tag.getTagName(),
    comment: (tag.getCommentText() ?? "").trim()
  }));
}

function toServiceFunction(
  module: string,
  name: string,
  node: ServiceFunctionNode,
  docs: JSDoc[]
): ServiceFunction {
  const params: ServiceParam[] = [];
  for (const param of node.getParameters()) {
    params.push(readParam(param, params));
  }
  // The block closest to the declaration is its doc — description AND tags.
  // An earlier block is a stray comment that happens to sit above it.
  const doc = docs[docs.length - 1];
  return {
    module,
    name,
    toolName: `${module}_${name}`,
    node,
    params,
    jsdoc: doc ? doc.getText().slice(3, -2) : undefined,
    tags: doc ? readTags(doc) : []
  };
}

/** Every exported function of a file — declarations AND arrow/function consts. */
export function exportedFunctions(
  module: string,
  source: SourceFile
): ServiceFunction[] {
  const found: { pos: number; fn: ServiceFunction }[] = [];

  for (const fn of source.getFunctions()) {
    const name = fn.getName();
    if (!name || !fn.isExported() || !fn.hasBody()) continue;
    found.push({
      pos: fn.getStart(),
      fn: toServiceFunction(module, name, fn, fn.getJsDocs())
    });
  }

  for (const statement of source.getVariableStatements()) {
    if (!statement.isExported()) continue;
    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      if (
        !initializer ||
        !(
          Node.isArrowFunction(initializer) ||
          Node.isFunctionExpression(initializer)
        )
      ) {
        continue;
      }
      found.push({
        pos: declaration.getStart(),
        fn: toServiceFunction(
          module,
          declaration.getName(),
          initializer,
          statement.getJsDocs()
        )
      });
    }
  }

  return found.sort((a, b) => a.pos - b.pos).map((entry) => entry.fn);
}

/** The exported functions of service source held in memory — no files, no
 *  tsconfig. What the tests feed the generator's questions with. */
export function parseServiceSource(
  module: string,
  source: string
): ServiceFunction[] {
  const project = new Project({ useInMemoryFileSystem: true });
  return exportedFunctions(
    module,
    project.createSourceFile(`${module}.service.ts`, source)
  );
}

/**
 * Parse every module's service file — plus its `mcp.server.ts` companion, for
 * the tools that must import `*.server` modules and so cannot live in the
 * client-reachable service file. A same-named companion export SHADOWS the
 * service one, matching the runtime registry where the companion's spread wins,
 * and here the shadow is total: the wrapper's own parameters, doc and BODY are
 * what get published and inspected.
 */
export function buildServiceAst(modules: readonly string[]): ServiceAst {
  const project = new Project({
    tsConfigFilePath: path.join(ERP_ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true
  });
  const out = new Map<string, ServiceModule>();

  for (const mod of modules) {
    // A module may keep its single service file under the `.ee`-licensed name.
    const servicePath = [`${mod}.service.ts`, `${mod}.ee.service.ts`]
      .map((file) => path.join(MODULES_DIR, mod, file))
      .find((file) => fs.existsSync(file));
    if (!servicePath) continue;

    const service = project.addSourceFileAtPath(servicePath);
    let functions = exportedFunctions(mod, service);
    let text = service.getFullText();

    const companionPath = path.join(MODULES_DIR, mod, `${mod}.mcp.server.ts`);
    if (fs.existsSync(companionPath)) {
      const companion = project.addSourceFileAtPath(companionPath);
      const companionFunctions = exportedFunctions(mod, companion);
      const shadowed = new Set(companionFunctions.map((fn) => fn.name));
      functions = [
        ...functions.filter((fn) => !shadowed.has(fn.name)),
        ...companionFunctions
      ];
      text = `${text}\n${companion.getFullText()}`;
    }

    out.set(mod, { functions, text });
  }

  return { project, modules: out };
}

// ---------------------------------------------------------------------------
// What a body does
// ---------------------------------------------------------------------------

export type DbWriteKind = "insert" | "update" | "delete";

// Maps, not object literals: a member named `toString` or `constructor` would
// otherwise find Object.prototype's and read as a write.
const SUPABASE_WRITES = new Map<string, DbWriteKind>([
  ["insert", "insert"],
  ["upsert", "insert"],
  ["update", "update"],
  ["delete", "delete"]
]);
const KYSELY_WRITES = new Map<string, DbWriteKind>([
  ["insertInto", "insert"],
  ["updateTable", "update"],
  ["deleteFrom", "delete"]
]);

/** Peel wrappers that do not change what an expression evaluates to. */
function unwrap(node: Node | undefined): Node | undefined {
  let current = node;
  while (current) {
    if (
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isAwaitExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isTypeAssertion(current)
    ) {
      current = current.getExpression();
      continue;
    }
    return current;
  }
  return undefined;
}

function memberName(call: CallExpression): string | undefined {
  const callee = unwrap(call.getExpression());
  if (callee && Node.isPropertyAccessExpression(callee)) {
    return callee.getName();
  }
  if (callee && Node.isIdentifier(callee)) return callee.getText();
  return undefined;
}

function stringArgument(call: CallExpression): string | undefined {
  // `.from("accountingSyncTieOut" as any)`: a cast does not change the name.
  const arg = unwrap(call.getArguments()[0]);
  if (
    arg &&
    (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))
  ) {
    return arg.getLiteralText();
  }
  return undefined;
}

/** `x.storage.from("bucket")` names a storage bucket, not a relation. */
function isStorageFrom(call: CallExpression): boolean {
  const callee = unwrap(call.getExpression());
  if (!callee || !Node.isPropertyAccessExpression(callee)) return false;
  const receiver = unwrap(callee.getExpression());
  return (
    receiver !== undefined &&
    Node.isPropertyAccessExpression(receiver) &&
    receiver.getName() === "storage"
  );
}

/**
 * The `.from(…)` call a supabase chain is rooted in, following the receiver of
 * each member call down the chain and through one local variable
 * (`const query = client.from("t"); query.delete()`). Undefined when the chain
 * is not a query at all — which is what separates `client.from("t").delete()`
 * from `members.delete(id)` on a Set.
 */
function queryRoot(node: Node | undefined, depth = 0): CallExpression | undefined {
  const current = unwrap(node);
  if (!current || depth > 4) return undefined;

  if (Node.isCallExpression(current)) {
    if (memberName(current) === "from" && !isStorageFrom(current)) {
      return current;
    }
    const callee = unwrap(current.getExpression());
    return callee && Node.isPropertyAccessExpression(callee)
      ? queryRoot(callee.getExpression(), depth)
      : undefined;
  }
  if (Node.isPropertyAccessExpression(current)) {
    return queryRoot(current.getExpression(), depth);
  }
  if (Node.isIdentifier(current)) {
    const declaration = current.getSymbol()?.getValueDeclaration();
    return declaration && Node.isVariableDeclaration(declaration)
      ? queryRoot(declaration.getInitializer(), depth + 1)
      : undefined;
  }
  return undefined;
}

export interface DbWrite {
  kind: DbWriteKind;
  /** The relation, when it is named by a string literal. */
  table?: string;
}

/** Every database write a function's own body performs. */
export function dbWrites(fn: ServiceFunctionNode): DbWrite[] {
  const writes: DbWrite[] = [];
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = memberName(call);
    if (!name) continue;

    const kysely = KYSELY_WRITES.get(name);
    if (kysely) {
      writes.push({ kind: kysely, table: stringArgument(call) });
      continue;
    }

    const supabase = SUPABASE_WRITES.get(name);
    if (!supabase) continue;
    const callee = unwrap(call.getExpression());
    if (!callee || !Node.isPropertyAccessExpression(callee)) continue;
    const root = queryRoot(callee.getExpression());
    if (root) writes.push({ kind: supabase, table: stringArgument(root) });
  }
  return writes;
}

/**
 * The SQL functions a body calls through `.rpc("name", …)`. A name that is not a
 * string literal is reported as `null`: the call is there, but which function
 * it reaches cannot be read.
 */
export function rpcCalls(fn: ServiceFunctionNode): Array<string | null> {
  const names: Array<string | null> = [];
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (memberName(call) !== "rpc") continue;
    const callee = unwrap(call.getExpression());
    if (!callee || !Node.isPropertyAccessExpression(callee)) continue;
    // The name may sit under a cast: `.rpc("a" as unknown as "b", …)`.
    const name = unwrap(call.getArguments()[0]);
    names.push(
      name &&
        (Node.isStringLiteral(name) ||
          Node.isNoSubstitutionTemplateLiteral(name))
        ? name.getLiteralText()
        : null
    );
  }
  return names;
}

export interface ParamFilter {
  /** The parameter, or a field of it: `jobId`, `args.jobId`. */
  path: string;
  table: string;
  column: string;
}

/** `jobId` → "jobId", `args.jobId` → "args.jobId", when rooted in one of the function's own parameters. */
function parameterPath(
  node: Node | undefined,
  own: ReadonlySet<Node>
): string | undefined {
  const value = unwrap(node);
  if (!value) return undefined;

  if (Node.isPropertyAccessExpression(value)) {
    const root = parameterPath(value.getExpression(), own);
    return root ? `${root}.${value.getName()}` : undefined;
  }
  if (!Node.isIdentifier(value)) return undefined;

  const declaration = value.getSymbol()?.getValueDeclaration();
  if (!declaration) return undefined;
  if (Node.isParameterDeclaration(declaration)) {
    return own.has(declaration) ? declaration.getName() : undefined;
  }
  // `const { jobId } = args`, or a destructured parameter `({ jobId }: Args)`.
  if (Node.isBindingElement(declaration)) {
    const pattern = declaration.getParent();
    const holder = pattern.getParent();
    const field = declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
    if (Node.isParameterDeclaration(holder)) {
      return own.has(holder) ? `${serviceParamName(holder)}.${field}` : undefined;
    }
    if (Node.isVariableDeclaration(holder)) {
      const root = parameterPath(holder.getInitializer(), own);
      return root ? `${root}.${field}` : undefined;
    }
  }
  return undefined;
}

function serviceParamName(param: ParameterDeclaration): string {
  const nameNode = param.getNameNode();
  return Node.isObjectBindingPattern(nameNode) ||
    Node.isArrayBindingPattern(nameNode)
    ? "destructured"
    : nameNode.getText();
}

/** Filters whose column holds values the parameter is comparable with. */
const COMPARISONS = new Set(["eq", "in", "lte", "gte", "lt", "gt"]);

/**
 * Where the function compares one of its parameters to a column: a supabase
 * `.eq("col", param)` / `.in("col", param)`, or a range test
 * (`.lte("startDate", date)`), on a `.from("table")` chain. It says
 * what a parameter IS — `jobId` compared to `job.id` is a job's record id — so
 * a caller (or a test) can supply a value that exists.
 */
export function paramFilters(fn: ServiceFunctionNode): ParamFilter[] {
  const own = new Set<Node>(fn.getParameters());
  const filters: ParamFilter[] = [];
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = memberName(call);
    if (!name || !COMPARISONS.has(name)) continue;
    const callee = unwrap(call.getExpression());
    if (!callee || !Node.isPropertyAccessExpression(callee)) continue;
    const column = stringArgument(call);
    const root = queryRoot(callee.getExpression());
    const table = root ? stringArgument(root) : undefined;
    const path = parameterPath(call.getArguments()[1], own);
    if (column && table && path) filters.push({ path, table, column });
  }
  return filters;
}

/** Columns that record who wrote a row. */
const AUDIT_COLUMNS = new Set(["createdBy", "updatedBy"]);

function propertyKey(node: Node): string | undefined {
  if (Node.isIdentifier(node)) return node.getText();
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return undefined;
}

/**
 * The function's own parameters that it writes into an audit column: the value
 * of a `createdBy` / `updatedBy` property, by shorthand (`{ updatedBy }`) or by
 * name (`{ createdBy: actor }`). Whatever such a parameter is called, the row
 * says it is who made the write, so the caller is never the one to supply it.
 */
export function auditParams(fn: ServiceFunctionNode): string[] {
  const own = new Set<Node>(fn.getParameters());
  const found = new Set<string>();

  const record = (symbol: MorphSymbol | undefined) => {
    const declaration = symbol?.getValueDeclaration();
    if (
      declaration &&
      Node.isParameterDeclaration(declaration) &&
      own.has(declaration)
    ) {
      found.add(declaration.getName());
    }
  };

  for (const node of fn.getDescendants()) {
    if (Node.isShorthandPropertyAssignment(node)) {
      if (AUDIT_COLUMNS.has(node.getName())) record(node.getValueSymbol());
    } else if (Node.isPropertyAssignment(node)) {
      const key = propertyKey(node.getNameNode());
      if (!key || !AUDIT_COLUMNS.has(key)) continue;
      const value = unwrap(node.getInitializer());
      if (value && Node.isIdentifier(value)) record(value.getSymbol());
    }
  }
  return fn
    .getParameters()
    .map((p) => p.getName())
    .filter((name) => found.has(name));
}

/**
 * Relations the function names — `.from("t")`, `insertInto("t")`,
 * `updateTable("t")`. Reads count: a function that reads one table and writes
 * another yields two names, which the audit-column rule treats as "can't tell".
 */
export function namedTables(fn: ServiceFunctionNode): string[] {
  const names = new Set<string>();
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = memberName(call);
    if (name !== "from" && name !== "insertInto" && name !== "updateTable") {
      continue;
    }
    if (name === "from" && isStorageFrom(call)) continue;
    const table = stringArgument(call);
    if (table) names.add(table);
  }
  return [...names];
}

/** Whether the function applies limit/offset itself. */
export function paginates(fn: ServiceFunctionNode): boolean {
  return fn
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((call) => {
      const name = memberName(call);
      return name === "setGenericQueryFilters" || name === "range";
    });
}

/**
 * Whether the function branches on `"createdBy" in x` / `"updatedBy" in x` to
 * pick its insert-vs-update path — the `in` operator itself, not the words.
 */
export function branchesOnKeyPresence(
  fn: ServiceFunctionNode,
  keys: readonly string[]
): boolean {
  return fn
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .some((binary) => {
      if (binary.getOperatorToken().getKind() !== SyntaxKind.InKeyword) {
        return false;
      }
      const left = binary.getLeft();
      return (
        (Node.isStringLiteral(left) ||
          Node.isNoSubstitutionTemplateLiteral(left)) &&
        keys.includes(left.getLiteralText())
      );
    });
}

/**
 * Whether sending `id` is what separates an update from an insert, read off the
 * payload parameter's TYPE: every member of its union that requires `updatedBy`
 * (the update shape) has an `id`, and no other member has an `id` AT ALL. Then
 * "an id was sent" is not a guess about intent — the service's own signature
 * says a create carries none.
 *
 * False when a create may carry an `id` too, required or optional (a part's
 * `id` is its part number on create; a document section may be created under a
 * chosen id), or when neither shape has one (a pick method is keyed by item
 * and location). There an `id` proves nothing and the row has to be looked up.
 */
export function idDistinguishesUpdate(
  fn: ServiceFunctionNode,
  contextParams: ReadonlySet<string>
): boolean {
  for (const param of fn.getParameters()) {
    if (contextParams.has(param.getName())) continue;
    const type = param.getType();
    const members = type.isUnion() ? type.getUnionTypes() : [type];
    // The update shape is the one that REQUIRES `updatedBy`. A validator may
    // itself carry an optional `createdBy`, so its presence proves nothing.
    const updates = members.filter((m) => {
      const updatedBy = m.getProperty("updatedBy");
      return updatedBy !== undefined && !updatedBy.hasFlags(SymbolFlags.Optional);
    });
    const creates = members.filter((m) => !updates.includes(m));
    if (updates.length === 0 || creates.length === 0) continue;

    return (
      updates.every((m) => m.getProperty("id") !== undefined) &&
      creates.every((m) => m.getProperty("id") === undefined)
    );
  }
  return false;
}
