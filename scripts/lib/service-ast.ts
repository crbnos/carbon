// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * What a published service function's input IS, read off the code: which
 * column each input field is compared to. The tool sweep uses it to call a
 * tool with values that exist.
 *
 * A published operation is a router leaf (`defineServiceFn`). Its `run` usually
 * hands its input to a building block in a `.service.ts`
 * (`service.getJob(client, input.jobId)`), and the comparison lives there, on
 * the building block's own parameter. So the building block's filters are read
 * and its parameter is rewritten to the input field it was given.
 */
import * as path from "path";
import {
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  Node,
  type ParameterDeclaration,
  Project,
  type PropertyAccessExpression,
  type SourceFile,
  SyntaxKind
} from "ts-morph";
import { routerLeaves } from "./service-fn-metadata";

const ERP_TSCONFIG = path.resolve(__dirname, "../../apps/erp/tsconfig.json");

export type ServiceFunctionNode =
  | FunctionDeclaration
  | ArrowFunction
  | FunctionExpression
  | MethodDeclaration;

/** The exported functions of source held in memory: what the tests feed `paramFilters`. */
export function parseServiceSource(
  module: string,
  source: string
): { name: string; node: ServiceFunctionNode }[] {
  const file = new Project({ useInMemoryFileSystem: true }).createSourceFile(
    `${module}.service.ts`,
    source
  );
  return file
    .getFunctions()
    .filter((fn) => fn.isExported() && fn.hasBody())
    .map((node) => ({ name: node.getName() ?? "", node }));
}

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
 * (`const query = client.from("t"); query.eq(…)`). Undefined when the chain
 * is not a query at all.
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

export interface ParamFilter {
  /** The parameter, or a field of it: `jobId`, `args.jobId`. */
  path: string;
  table: string;
  column: string;
}

function serviceParamName(param: ParameterDeclaration): string {
  const nameNode = param.getNameNode();
  return Node.isObjectBindingPattern(nameNode) ||
    Node.isArrayBindingPattern(nameNode)
    ? "destructured"
    : nameNode.getText();
}

/** `jobId` → "jobId", `args.jobId` → "args.jobId", when rooted in one of `own`. */
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
    const holder = declaration.getParent().getParent();
    let root: string | undefined;
    if (Node.isParameterDeclaration(holder)) {
      root = own.has(holder) ? serviceParamName(holder) : undefined;
    } else if (Node.isVariableDeclaration(holder)) {
      root = parameterPath(holder.getInitializer(), own);
    }
    if (!root) return undefined;
    // `...rest` holds the fields that were not named: the object itself.
    if (declaration.getDotDotDotToken()) return root;
    const field =
      declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
    return `${root}.${field}`;
  }
  return undefined;
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

/** The repo function a call runs, when it is one with a body. */
function calledFunction(call: CallExpression): ServiceFunctionNode | undefined {
  const callee = unwrap(call.getExpression());
  const name = Node.isPropertyAccessExpression(callee)
    ? callee.getNameNode()
    : Node.isIdentifier(callee)
      ? callee
      : undefined;
  const definition = name?.getDefinitionNodes()[0];
  if (!definition || definition.getSourceFile().isInNodeModules()) {
    return undefined;
  }
  if (Node.isFunctionDeclaration(definition)) {
    return definition.hasBody() ? definition : undefined;
  }
  const init = Node.isVariableDeclaration(definition)
    ? definition.getInitializer()
    : undefined;
  return Node.isArrowFunction(init) || Node.isFunctionExpression(init)
    ? init
    : undefined;
}

/**
 * The filters of a leaf's `run(ctx, input)`, as paths into `input`: its own,
 * and those of each function it passes input to — a field
 * (`service.getJob(client, input.jobId)`), the whole input, or the input
 * with the caller's identity on it (`payload(ctx, input)…forUpdate()`).
 */
/** The value inside a `payload(ctx, value)…forX()` chain, else `node`. */
function payloadValue(node: Node | undefined): Node | undefined {
  let inner: Node | undefined = node;
  while (
    Node.isCallExpression(inner) &&
    Node.isPropertyAccessExpression(inner.getExpression())
  ) {
    inner = (inner.getExpression() as PropertyAccessExpression).getExpression();
  }
  return Node.isCallExpression(inner) && memberName(inner) === "payload"
    ? unwrap(inner.getArguments()[1])
    : node;
}

export function inputFilters(run: ServiceFunctionNode): ParamFilter[] {
  const input = run.getParameters()[1];
  if (!input) return [];
  const own = new Set<Node>([input]);
  const root = serviceParamName(input);
  const intoInput = (at: string | undefined) =>
    at === root
      ? ""
      : at?.startsWith(`${root}.`)
        ? at.slice(root.length + 1)
        : undefined;
  const filters: ParamFilter[] = [];
  const add = (filter: ParamFilter, at: string | undefined) => {
    if (at) filters.push({ ...filter, path: at });
  };

  for (const filter of paramFilters(run)) {
    add(filter, intoInput(filter.path));
  }
  for (const call of run.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const target = calledFunction(call);
    if (!target) continue;
    const params = target.getParameters();
    const given = new Map<string, string>();
    call.getArguments().forEach((argument, index) => {
      let value = unwrap(argument);
      value = payloadValue(value) ?? value;
      const at = intoInput(parameterPath(value, own));
      const param = params[index];
      if (param && at !== undefined) given.set(serviceParamName(param), at);
    });
    if (given.size === 0) continue;
    for (const filter of paramFilters(target)) {
      const [head = "", ...rest] = filter.path.split(".");
      const base = given.get(head);
      if (base !== undefined) {
        add(filter, [base, ...rest].filter(Boolean).join("."));
      }
    }
  }
  return filters;
}

/** The `run` of a `defineServiceFn({ … })` call. */
export function runOf(call: CallExpression): ServiceFunctionNode | undefined {
  const definition = call.getArguments()[0];
  if (!Node.isObjectLiteralExpression(definition)) return undefined;
  const run = definition.getProperty("run");
  if (Node.isMethodDeclaration(run)) return run;
  const init = Node.isPropertyAssignment(run) ? run.getInitializer() : undefined;
  return Node.isArrowFunction(init) || Node.isFunctionExpression(init)
    ? init
    : undefined;
}

/** `.selectFrom("item as i")` / `.insertInto("item")` name a relation too (Kysely). */
const KYSELY_RELATION_CALLS = new Set([
  "selectFrom",
  "insertInto",
  "updateTable",
  "deleteFrom"
]);

/** The relations one function body queries: `.from("t")` and Kysely's calls. */
function relationsIn(fn: Node): string[] {
  const out: string[] = [];
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = memberName(call);
    const isFrom = name === "from" && !isStorageFrom(call);
    if (!isFrom && !KYSELY_RELATION_CALLS.has(name ?? "")) continue;
    const relation = stringArgument(call)?.split(/\s+as\s+/i)[0]?.trim();
    if (relation && /^\w+$/.test(relation)) out.push(relation);
  }
  return out;
}

/** A function declared at the top level of `file`, with a body. */
function declaredFunction(
  file: SourceFile,
  name: string
): ServiceFunctionNode | undefined {
  const fn = file.getFunction(name);
  if (fn?.hasBody()) return fn;
  const init = file.getVariableDeclaration(name)?.getInitializer();
  return Node.isArrowFunction(init) || Node.isFunctionExpression(init)
    ? init
    : undefined;
}

/**
 * The repo function a call runs, found through the file's imports alone
 * (`service.getX(…)` from `import * as service`, a named import, or a function
 * of the same file) — no type checker, which the manifest build cannot afford.
 */
function importedFunction(call: CallExpression): ServiceFunctionNode | undefined {
  const callee = unwrap(call.getExpression());
  const file = call.getSourceFile();
  if (Node.isIdentifier(callee)) {
    const name = callee.getText();
    const local = declaredFunction(file, name);
    if (local) return local;
    for (const declaration of file.getImportDeclarations()) {
      const specifier = declaration
        .getNamedImports()
        .find((named) => (named.getAliasNode() ?? named.getNameNode()).getText() === name);
      const target = specifier && declaration.getModuleSpecifierSourceFile();
      if (target) return declaredFunction(target, specifier.getName());
    }
    return undefined;
  }
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const namespace = unwrap(callee.getExpression());
  if (!namespace || !Node.isIdentifier(namespace)) return undefined;
  const declaration = file
    .getImportDeclarations()
    .find((d) => d.getNamespaceImport()?.getText() === namespace.getText());
  const target = declaration?.getModuleSpecifierSourceFile();
  return target ? declaredFunction(target, callee.getName()) : undefined;
}

/**
 * The relations a leaf's `run` queries: its own and those of each repo function
 * it calls directly (`service.getIssueTypesList(client, companyId)`).
 */
export function queriedRelations(run: ServiceFunctionNode): Set<string> {
  const out = new Set(relationsIn(run));
  for (const call of run.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const target = importedFunction(call);
    if (target) for (const relation of relationsIn(target)) out.add(relation);
  }
  return out;
}

/** Every router leaf's input filters, by tool name (`module_function`). */
export function publishedParamFilters(
  project = new Project({
    tsConfigFilePath: ERP_TSCONFIG,
    skipAddingFilesFromTsConfig: true
  }),
  routerFile?: string
): Map<string, ParamFilter[]> {
  const out = new Map<string, ParamFilter[]>();
  for (const leaf of routerLeaves(project, routerFile)) {
    const run = runOf(leaf.call);
    if (run) out.set(leaf.path.join("_"), inputFilters(run));
  }
  return out;
}
