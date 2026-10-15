// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Manifest entries for the service functions (`defineServiceFn`) that the ERP
 * router publishes. The router (`apps/erp/app/modules/router.server.ts`) is the
 * source: a leaf is published when its TSDoc carries `@mcp`. The summary line
 * is the title, `@remarks` the description, `@mcp destructive` the
 * classification override. Input and response schemas come from the leaf's
 * TYPE, through the same reflection the legacy tools use.
 */

import * as path from "path";
import type {
  Classification,
  ManifestEntry,
  PermissionAction,
  ToolPermission
} from "@carbon/api";
import {
  type CallExpression,
  Node,
  type ObjectLiteralExpression,
  type Project,
  type Symbol as TsSymbol,
  type VariableDeclaration
} from "ts-morph";
import {
  type JsonSchema,
  typeToJsonSchema,
  unwrapResponseType
} from "./response-schema";

const ROUTER_FILE = path.resolve(
  __dirname,
  "../../apps/erp/app/modules/router.server.ts"
);

const ACTIONS: PermissionAction[] = ["view", "create", "update", "delete"];

export interface ServiceFnLeaf {
  path: string[];
  declaration: VariableDeclaration;
  call: CallExpression;
}

function variableOf(symbol: TsSymbol | undefined): VariableDeclaration | null {
  const target = symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
  return target?.getDeclarations().find(Node.isVariableDeclaration) ?? null;
}

function defineCall(declaration: VariableDeclaration): CallExpression | null {
  const init = declaration.getInitializer();
  return init &&
    Node.isCallExpression(init) &&
    init.getExpression().getText() === "defineServiceFn"
    ? init
    : null;
}

/** Every `defineServiceFn` leaf of the router, with its path. */
export function routerLeaves(
  project: Project,
  routerFile = ROUTER_FILE
): ServiceFnLeaf[] {
  const file =
    project.getSourceFile(routerFile) ??
    project.addSourceFileAtPath(routerFile);
  project.resolveSourceFileDependencies();

  const root = file.getVariableDeclarationOrThrow("router").getInitializer();
  if (!root || !Node.isObjectLiteralExpression(root)) {
    throw new Error(`${routerFile}: \`router\` must be an object literal`);
  }

  const leaves: ServiceFnLeaf[] = [];
  const walk = (node: ObjectLiteralExpression, at: string[]) => {
    for (const property of node.getProperties()) {
      let key: string;
      let symbol: TsSymbol | undefined;
      let value: Node | undefined;
      if (Node.isShorthandPropertyAssignment(property)) {
        key = property.getName();
        // The name's own symbol is the property; the value is what it names.
        symbol = property.getValueSymbol();
      } else if (Node.isPropertyAssignment(property)) {
        key = property.getName();
        value = property.getInitializerOrThrow();
        if (Node.isIdentifier(value)) symbol = value.getSymbol();
      } else {
        throw new Error(
          `${property.getSourceFile().getFilePath()}: a router entry must be a property, not ${property.getKindName()}`
        );
      }

      const path = [...at, key];
      if (value && Node.isObjectLiteralExpression(value)) {
        walk(value, path);
        continue;
      }
      const declaration = variableOf(symbol);
      const init = declaration?.getInitializer();
      if (!declaration || !init) {
        throw new Error(
          `router.${path.join(".")}: cannot find the declaration it names`
        );
      }
      const call = defineCall(declaration);
      if (call) {
        leaves.push({ path, declaration, call });
      } else if (Node.isObjectLiteralExpression(init)) {
        walk(init, path);
      } else {
        throw new Error(
          `router.${path.join(".")}: must be a namespace object or a defineServiceFn`
        );
      }
    }
  };
  walk(root, []);
  return leaves;
}

export interface LeafDocs {
  title: string;
  description: string;
  published: boolean;
  destructive: boolean;
}

/** The leaf's TSDoc: the summary, `@remarks`, and `@mcp [destructive]`. */
export function leafDocs(leaf: ServiceFnLeaf): LeafDocs {
  const where = `router.${leaf.path.join(".")}`;
  const doc = leaf.declaration.getVariableStatement()?.getJsDocs().at(-1);
  const summary = doc?.getDescription().trim().split(/\n\s*\n/)[0] ?? "";
  const title = summary.replace(/\s+/g, " ").replace(/\.$/, "");
  const tags = doc?.getTags() ?? [];
  const remarks = tags
    .find((tag) => tag.getTagName() === "remarks")
    ?.getCommentText()
    ?.trim();
  const mcp = tags.filter((tag) => tag.getTagName() === "mcp");
  if (mcp.length > 1) throw new Error(`${where}: more than one @mcp tag`);
  const modifier = mcp[0]?.getCommentText()?.trim() ?? "";
  if (modifier !== "" && modifier !== "destructive") {
    throw new Error(
      `${where}: @mcp takes nothing or "destructive", not "${modifier}"`
    );
  }
  if (mcp.length > 0 && !title) {
    throw new Error(`${where}: a published service function needs a summary`);
  }
  return {
    title,
    description: remarks ? `${title}.\n\n${remarks}` : title,
    published: mcp.length > 0,
    destructive: modifier === "destructive"
  };
}

function stringsOf(node: Node | undefined): string[] | null {
  if (!node) return null;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
    return [node.getLiteralValue()];
  if (Node.isArrayLiteralExpression(node)) {
    const values = node.getElements().map((element) => stringsOf(element));
    return values.every((v) => v?.length === 1)
      ? values.map((v) => v![0])
      : null;
  }
  return null;
}

/**
 * The API gate's view of the declared permission. The gate checks one module;
 * a permission naming several modules publishes module `null` (membership
 * only) and the function's own gate decides. A published function must name
 * its permission: `"system"`, `{}` and a keyed rule are refused.
 */
export function leafPermission(leaf: ServiceFnLeaf): {
  permission: ToolPermission;
  actions: PermissionAction[];
} {
  const where = `router.${leaf.path.join(".")}`;
  const definition = leaf.call.getArguments()[0];
  const property =
    definition && Node.isObjectLiteralExpression(definition)
      ? definition.getProperty("permission")
      : undefined;
  const value =
    property && Node.isPropertyAssignment(property)
      ? property.getInitializer()
      : undefined;
  if (!value) throw new Error(`${where}: no literal \`permission\``);

  if (!Node.isObjectLiteralExpression(value)) {
    throw new Error(
      `${where}: a published service function names its permission ({ update: "<module>" }), not ${value.getText()}`
    );
  }
  if (value.getProperty("by")) {
    throw new Error(`${where}: a keyed permission cannot be published yet`);
  }

  const modules = new Set<string>();
  const actions: PermissionAction[] = [];
  for (const action of ACTIONS) {
    const entry = value.getProperty(action);
    if (!entry) continue;
    const names = Node.isPropertyAssignment(entry)
      ? stringsOf(entry.getInitializer())
      : null;
    if (!names || names.length === 0) {
      throw new Error(`${where}: permission.${action} must be string literals`);
    }
    for (const name of names) modules.add(name);
    actions.push(action);
  }
  if (actions.length === 0) {
    throw new Error(`${where}: a published service function names its permission, not {}`);
  }
  const [module] = modules;
  return {
    permission:
      modules.size === 1 && module ? { module, actions } : { module: null, actions: [] },
    actions
  };
}

function classify(
  actions: PermissionAction[],
  destructive: boolean
): Classification {
  if (destructive || actions.includes("delete")) return "DESTRUCTIVE";
  return actions.length > 0 && actions.every((a) => a === "view")
    ? "READ"
    : "WRITE";
}

/**
 * The checker orders a union's members by its own type ids, which move when
 * the program's files change, so an unrelated edit reordered an enum and
 * changed the schema's digest. JSON Schema gives `enum` no order: sort it.
 */
function sortEnums(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "enum" && Array.isArray(value)) {
      out[key] = [...value].sort();
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        item && typeof item === "object" ? sortEnums(item as JsonSchema) : item
      );
    } else if (value && typeof value === "object") {
      out[key] = sortEnums(value as JsonSchema);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function schemasOf(leaf: ServiceFnLeaf): {
  input: JsonSchema;
  response?: JsonSchema;
} {
  const at = leaf.declaration;
  const signature = at.getType().getCallSignatures()[0];
  const parameter = signature?.getParameters()[1];
  if (!signature || !parameter) {
    throw new Error(`router.${leaf.path.join(".")}: not a callable service function`);
  }
  const input = typeToJsonSchema(
    parameter.getTypeAtLocation(at),
    at,
    0,
    new Set(),
    true
  );
  const response = typeToJsonSchema(
    unwrapResponseType(signature.getReturnType(), at),
    at
  );
  return {
    input: Object.keys(input).length > 0 ? sortEnums(input) : { type: "object" },
    ...(Object.keys(response).length > 0
      ? { response: sortEnums(response) }
      : {})
  };
}

/** The published leaves as manifest entries. */
export function buildServiceFnTools(
  project: Project,
  routerFile = ROUTER_FILE
): ManifestEntry[] {
  return routerLeaves(project, routerFile).flatMap((leaf) => {
    const docs = leafDocs(leaf);
    if (!docs.published) return [];
    const where = `router.${leaf.path.join(".")}`;
    if (leaf.path.length < 2) {
      throw new Error(`${where}: a published leaf needs a module namespace`);
    }
    const { permission, actions } = leafPermission(leaf);
    const { input, response } = schemasOf(leaf);
    return [
      {
        name: leaf.path.join("_"),
        module: leaf.path[0]!,
        classification: classify(actions, docs.destructive),
        title: docs.title,
        description: docs.description,
        paramCount: 1,
        serviceParams: ["input"],
        contextParams: {},
        injectAuth: [],
        resultShape: "envelope",
        permission,
        paginates: false,
        schema: input,
        ...(response ? { responseSchema: response } : {}),
        serviceFn: { path: leaf.path }
      }
    ];
  });
}

/**
 * The service.ts tools plus the router's, as one manifest. Both
 * `generate-mcp` and `check-manifest` build it here, so the digest they
 * compare cannot differ by construction.
 */
export function withServiceFnTools(
  legacy: ManifestEntry[],
  project: Project
): ManifestEntry[] {
  const serviceFnTools = buildServiceFnTools(project);
  const legacyNames = new Set(legacy.map((tool) => tool.name));
  const clash = serviceFnTools.find((tool) => legacyNames.has(tool.name));
  if (clash) {
    throw new Error(
      `The service function ${clash.name} has the name of a published service.ts function. Rename one of them.`
    );
  }
  return [...legacy, ...serviceFnTools];
}
