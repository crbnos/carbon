/**
 * The declared context contract of every service operation, read from the
 * TypeScript signature with ts-morph.
 *
 * Which arguments the dispatcher fills from the authenticated context used to be
 * decided by three name rules: the function-name verb (`upsert*` stamps
 * createdBy + updatedBy), a hand-kept override table, and a list of parameter
 * names. None of them looked at what the service declares, so a payload got a
 * createdBy its table has no column for, an update silently rewrote the author,
 * a `clockIn` never got the createdBy it requires, and a positional `updatedBy`
 * received the whole request body.
 *
 * This index is the single source for that decision. Per operation it records:
 *
 * - each positional parameter's slot: a context value (`client`, `db`,
 *   `userId`, `companyId`, `companyGroupId`, `eliminationClient`, or
 *   `auditUser` for a positional createdBy/updatedBy), or `payload`;
 * - per payload parameter (or per element, for an array of rows) the identity
 *   fields it DECLARES, per union branch, plus any Kysely-typed field (a `db`
 *   the route builds and passes inside the payload);
 * - the `"<key>" in <param>` test a union param is discriminated by, so the
 *   dispatcher stamps exactly the branch the service will take.
 *
 * Built the same way as `buildResponseSchemaIndex` (response-schema.ts) and on
 * the same ts-morph Project, so the program is loaded once per generation.
 */

import * as fs from "fs";
import * as path from "path";
import type {
  AuthField,
  ContextSlot,
  ContextSlots,
  PayloadContext
} from "@carbon/api";
import {
  type FunctionDeclaration,
  Node,
  type ParameterDeclaration,
  Project,
  SyntaxKind,
  type Type
} from "ts-morph";

const ROOT = path.resolve(__dirname, "../..");
const ERP_ROOT = path.join(ROOT, "apps/erp");
const MODULES_DIR = path.join(ERP_ROOT, "app/modules");

/** Identity fields a payload can declare. The dispatcher overwrites these from
 *  the authenticated context whenever the service declares them. `userId` is
 *  handled separately (see `declaresPayloadUserId`). */
export const IDENTITY_FIELDS = [
  "companyId",
  "companyGroupId",
  "createdBy",
  "updatedBy"
] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

export type PositionalSlot =
  | "client"
  | "db"
  | "userId"
  | "companyId"
  | "companyGroupId"
  | "eliminationClient"
  | "auditUser";

/** What one union member (or the whole type, when it is not a union) declares. */
export interface DeclaredShape {
  /** Declared identity fields, sorted. */
  fields: IdentityField[];
  /** Properties typed `Kysely<…>` — filled with the database client. */
  db: string[];
  /** Every declared property name, for discriminator resolution. */
  keys: string[];
  /** Declared properties that are NOT optional. */
  requiredKeys: string[];
}

export interface PayloadSignature {
  /** The declared type is an array of rows; the shape describes one element. */
  elements: boolean;
  /** One entry per union member (a single entry when the type is not a union). */
  members: DeclaredShape[];
  /** `"<key>" in <param>` keys found in the function body, in source order. */
  inKeys: string[];
  /** An object whose fields cannot be read (`any`, `unknown`, `Json`,
   *  `Record<…>`) — a caller-sent identity key is overwritten, never removed. */
  opaque: boolean;
  /** A primitive (or array of primitives): nothing to stamp. */
  scalar: boolean;
}

export type ParamSignature =
  | { name: string; slot: PositionalSlot; optional: boolean }
  | {
      name: string;
      slot: "payload";
      optional: boolean;
      payload: PayloadSignature;
    };

export interface FunctionSignature {
  params: ParamSignature[];
}

export interface SignatureIndex {
  get(module: string, functionName: string): FunctionSignature | null;
  /** The declaration the signature was read from (for the write-site guards). */
  declaration(module: string, functionName: string): FunctionDeclaration | null;
  readonly project: Project;
}

function stripNullish(type: Type): Type {
  if (!type.isUnion()) return type;
  const concrete = type
    .getUnionTypes()
    .filter((t) => !t.isNull() && !t.isUndefined());
  return concrete.length === 1 ? concrete[0] : type;
}

function isNamed(type: Type, name: string): boolean {
  const symbol = type.getSymbol()?.getName();
  const alias = type.getAliasSymbol()?.getName();
  return symbol === name || alias === name;
}

function isSupabaseClient(type: Type): boolean {
  return isNamed(type, "SupabaseClient");
}

function isKysely(type: Type): boolean {
  return isNamed(type, "Kysely") || isNamed(type, "Transaction");
}

/** A property whose declared type annotation names Kysely. Read off the
 *  declaration rather than the resolved type: resolving every property of every
 *  validator-derived payload is what makes a full type walk slow. */
function propertyIsKysely(property: import("ts-morph").Symbol): boolean {
  return property.getDeclarations().some((declaration) => {
    if (!Node.isPropertySignature(declaration)) return false;
    const typeNode = declaration.getTypeNode();
    return typeNode !== undefined && /\bKysely\s*</.test(typeNode.getText());
  });
}

function positionalSlotOf(
  param: ParameterDeclaration,
  type: Type
): PositionalSlot | null {
  const name = param.getName();
  if (name === "eliminationClient") return "eliminationClient";
  if (isSupabaseClient(type)) return name === "client" ? "client" : null;
  if (isKysely(type)) return "db";
  if (name === "client") return "client";
  if (name === "db") return "db";
  if (name === "userId") return "userId";
  if (name === "companyId") return "companyId";
  if (name === "companyGroupId") return "companyGroupId";
  if (name === "createdBy" || name === "updatedBy") return "auditUser";
  return null;
}

function declaredShape(type: Type): DeclaredShape {
  const fields: IdentityField[] = [];
  const db: string[] = [];
  const keys: string[] = [];
  const requiredKeys: string[] = [];
  for (const property of type.getProperties()) {
    const name = property.getName();
    if (name.startsWith("__@")) continue;
    keys.push(name);
    if (!property.isOptional()) requiredKeys.push(name);
    if ((IDENTITY_FIELDS as readonly string[]).includes(name)) {
      fields.push(name as IdentityField);
    }
    if (propertyIsKysely(property)) db.push(name);
  }
  return {
    fields: fields.sort(),
    db: db.sort(),
    keys: keys.sort(),
    requiredKeys: requiredKeys.sort()
  };
}

function isObjectLike(type: Type): boolean {
  return (
    (type.isObject() || type.isIntersection()) &&
    !type.isArray() &&
    !type.isReadonlyArray() &&
    type.getCallSignatures().length === 0
  );
}

/**
 * The param plus every local derived from it one step away — a rest binding
 * (`const { copyFromId, ...rest } = procedure`) or a copy
 * (`const normalized = { ...jobOperation, … }`) — since services test the
 * discriminator on whichever of those they go on to write.
 */
export function paramAliases(
  fn: FunctionDeclaration,
  paramName: string
): Set<string> {
  const aliases = new Set([paramName]);
  for (const declaration of fn.getDescendantsOfKind(
    SyntaxKind.VariableDeclaration
  )) {
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const references =
      (Node.isIdentifier(initializer) && initializer.getText() === paramName) ||
      initializer
        .getDescendantsOfKind(SyntaxKind.Identifier)
        .some((id) => id.getText() === paramName);
    if (!references) continue;
    const nameNode = declaration.getNameNode();
    if (Node.isIdentifier(nameNode)) {
      aliases.add(nameNode.getText());
    } else if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        if (element.getDotDotDotToken()) aliases.add(element.getName());
      }
    }
  }
  return aliases;
}

/** `"key" in param` expressions inside the function body, in source order. */
function inDiscriminatorKeys(
  fn: FunctionDeclaration,
  paramName: string
): string[] {
  const aliases = paramAliases(fn, paramName);
  const keys: string[] = [];
  for (const expr of fn.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (expr.getOperatorToken().getKind() !== SyntaxKind.InKeyword) continue;
    const left = expr.getLeft();
    const right = expr.getRight();
    if (!Node.isStringLiteral(left)) continue;
    if (!aliases.has(right.getText())) continue;
    const key = left.getLiteralValue();
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

function payloadSignature(
  fn: FunctionDeclaration,
  param: ParameterDeclaration,
  type: Type
): PayloadSignature {
  let target = stripNullish(type);
  let elements = false;
  if (target.isArray() || target.isReadonlyArray()) {
    const element = target.getArrayElementType();
    if (element) {
      target = stripNullish(element);
      elements = true;
    }
  }

  const candidates = target.isUnion() ? target.getUnionTypes() : [target];
  const objects = candidates.filter(
    (t) => !t.isNull() && !t.isUndefined() && isObjectLike(t)
  );
  const loose =
    target.isAny() ||
    target.isUnknown() ||
    candidates.some((t) => t.isAny() || t.isUnknown());
  const scalar = !loose && objects.length === 0;
  const opaque =
    loose ||
    // `Record<string, …>` / `Json` declare no fields at all.
    (objects.length > 0 &&
      objects.every((t) => t.getProperties().length === 0));

  return {
    elements,
    members: objects.map((t) => declaredShape(t)),
    inKeys: Node.isIdentifier(param.getNameNode())
      ? inDiscriminatorKeys(fn, param.getName())
      : [],
    opaque,
    scalar
  };
}

function functionSignature(fn: FunctionDeclaration): FunctionSignature {
  return {
    params: fn.getParameters().map((param) => {
      const type = stripNullish(param.getType());
      const optional = param.isOptional() || param.hasInitializer();
      const name = Node.isIdentifier(param.getNameNode())
        ? param.getName()
        : "";
      const slot = positionalSlotOf(param, type);
      if (slot) return { name, slot, optional };
      return {
        name,
        slot: "payload" as const,
        optional,
        payload: payloadSignature(fn, param, type)
      };
    })
  };
}

let sharedProject: Project | null = null;

/** The ERP program with every service file added — shared with the response
 *  schema index so generation loads it once. */
export function serviceProject(modules: readonly string[]): {
  project: Project;
  sources: Array<{ mod: string; source: import("ts-morph").SourceFile }>;
} {
  const project =
    sharedProject ??
    new Project({
      tsConfigFilePath: path.join(ERP_ROOT, "tsconfig.json"),
      skipAddingFilesFromTsConfig: true
    });
  const fresh = sharedProject === null;
  sharedProject = project;
  const sources = modules.flatMap((mod) =>
    [`${mod}.service.ts`, `${mod}.ee.service.ts`, `${mod}.mcp.server.ts`]
      .map((name) => ({ mod, file: path.join(MODULES_DIR, mod, name) }))
      .filter((entry) => fs.existsSync(entry.file))
      .map((entry) => ({
        mod: entry.mod,
        source:
          project.getSourceFile(entry.file) ??
          project.addSourceFileAtPath(entry.file)
      }))
  );
  if (fresh) project.resolveSourceFileDependencies();
  return { project, sources };
}

/**
 * Read every exported service function's declared context contract. Keyed
 * `{module}_{fn}`; a `.mcp.server.ts` export shadows a same-named service export,
 * matching the runtime registry.
 */
export function buildSignatureIndex(
  modules: readonly string[]
): SignatureIndex {
  const { project, sources } = serviceProject(modules);
  const signatures = new Map<string, FunctionSignature>();
  const declarations = new Map<string, FunctionDeclaration>();
  // Service files first, so a companion `.mcp.server.ts` export overwrites.
  const ordered = [...sources].sort(
    (a, b) =>
      Number(a.source.getFilePath().endsWith(".mcp.server.ts")) -
      Number(b.source.getFilePath().endsWith(".mcp.server.ts"))
  );
  for (const { mod, source } of ordered) {
    for (const fn of source.getFunctions()) {
      if (!fn.isExported()) continue;
      const name = fn.getName();
      if (!name) continue;
      signatures.set(`${mod}_${name}`, functionSignature(fn));
      declarations.set(`${mod}_${name}`, fn);
    }
  }
  return {
    get(module, functionName) {
      return signatures.get(`${module}_${functionName}`) ?? null;
    },
    declaration(module, functionName) {
      return declarations.get(`${module}_${functionName}`) ?? null;
    },
    project
  };
}

// ---------------------------------------------------------------------------
// The contract the manifest publishes
// ---------------------------------------------------------------------------

/** A payload that declares `userId` (the edge-function wrappers and a few row
 *  writers) gets the caller stamped into it. Read off the SOURCE TEXT of the
 *  param type, exactly as before this contract existed: some services use a
 *  validator's `userId` for the target person, and widening the rule to every
 *  resolved type is a product decision that has not been taken. */
const PAYLOAD_USER_ID = /(^|[{;,\s])userId\s*\??\s*:/;

export interface TextualParam {
  name: string;
  typeStr: string;
}

export interface DerivedContract {
  contextSlots: ContextSlots;
  /** The union of every payload's declared identity fields (plus userId). */
  injectAuth: AuthField[];
  /** The operation needs the caller's `_operation` (an identity-field split). */
  needsOperation: boolean;
  /** Why the contract could not be derived; generation fails on any. */
  problems: string[];
}

const byName = (a: string, b: string) => a.localeCompare(b);

function sameFields(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((field, i) => field === b[i]);
}

/** The one field list every member of `members` agrees on, or null. */
export function agreedFields(members: DeclaredShape[]): IdentityField[] | null {
  if (members.length === 0) return null;
  const first = members[0].fields;
  return members.every((m) => sameFields(m.fields, first)) ? first : null;
}

/**
 * The branch fields of a union payload, split the way the service splits it.
 *
 * `"key" in param` narrows to the members that declare `key` when true, and to
 * the members that do not REQUIRE it when false — TypeScript's own rule. When
 * every member requires the key the test cannot fail, so the `else` branch is
 * unreachable by type; the service always takes the `key` branch. For `id` —
 * the only key this happens with — that branch is the edit of an existing row,
 * and the member it describes is the one that does not declare `createdBy`: an
 * edit never re-stamps the author.
 */
export function discriminate(
  payload: PayloadSignature
):
  | { key: string; present: IdentityField[]; absent: IdentityField[] }
  | { problem: string } {
  const members = payload.members;
  for (const key of payload.inKeys) {
    const declaring = members.filter((m) => m.keys.includes(key));
    if (declaring.length === 0) continue;
    const notRequiring = members.filter((m) => !m.requiredKeys.includes(key));
    if (notRequiring.length === 0) {
      if (key !== "id") continue;
      const edit = members.filter((m) => !m.fields.includes("createdBy"));
      const create = members.filter((m) => m.fields.includes("createdBy"));
      const present = agreedFields(edit);
      const absent = agreedFields(create);
      if (present && absent) return { key, present, absent };
      continue;
    }
    const present = agreedFields(declaring);
    const absent = agreedFields(notRequiring);
    if (present && absent && !sameFields(present, absent)) {
      return { key, present, absent };
    }
  }
  return {
    problem: `its members declare different identity fields (${members
      .map((m) => `[${m.fields.join(", ")}]`)
      .join(" | ")}) and no \`"<key>" in\` test in the body tells them apart${
      payload.inKeys.length > 0
        ? ` (tests found: ${payload.inKeys.join(", ")})`
        : ""
    }`
  };
}

function payloadContext(
  payload: PayloadSignature,
  declaresUserId: boolean
): { context: PayloadContext; needsOperation: boolean; problem?: string } {
  const withUserId = (fields: readonly AuthField[]): AuthField[] =>
    declaresUserId && !payload.elements && !fields.includes("userId")
      ? [...fields, "userId" as const].sort(byName)
      : [...fields];

  const db = [...new Set(payload.members.flatMap((m) => m.db))].sort(byName);
  const base: PayloadContext = {
    fields: [],
    ...(payload.elements ? { elements: true } : {}),
    ...(db.length > 0 ? { db } : {})
  };

  if (payload.scalar) {
    return { context: { ...base, fields: [] }, needsOperation: false };
  }

  if (payload.opaque) {
    return {
      context: { ...base, fields: withUserId([]), opaque: true },
      needsOperation: false
    };
  }

  const agreed = agreedFields(payload.members);
  if (agreed) {
    return {
      context: { ...base, fields: withUserId(agreed) },
      needsOperation: false
    };
  }

  const split = discriminate(payload);
  if ("problem" in split) {
    return { context: base, needsOperation: false, problem: split.problem };
  }
  const { key, present, absent } = split;

  if ((IDENTITY_FIELDS as readonly string[]).includes(key)) {
    // The dispatcher sets the key itself, so the caller has to say which branch
    // it means. `create` is the branch that stamps the author.
    const presentCreates = present.includes("createdBy");
    const absentCreates = absent.includes("createdBy");
    let create: IdentityField[] | null = null;
    let update: IdentityField[] | null = null;
    if (presentCreates !== absentCreates) {
      create = presentCreates ? present : absent;
      update = presentCreates ? absent : present;
    } else if (present.includes("updatedBy") !== absent.includes("updatedBy")) {
      update = present.includes("updatedBy") ? present : absent;
      create = present.includes("updatedBy") ? absent : present;
    }
    if (!create || !update) {
      return {
        context: base,
        needsOperation: false,
        problem: `it splits on the identity field "${key}" but neither branch is recognisably the create (createdBy) or the update (updatedBy) branch`
      };
    }
    return {
      context: {
        ...base,
        fields: [],
        byOperation: { create: withUserId(create), update: withUserId(update) }
      },
      needsOperation: true
    };
  }

  return {
    context: {
      ...base,
      fields: [],
      discriminator: {
        key,
        present: withUserId(present),
        absent: withUserId(absent)
      }
    },
    needsOperation: false
  };
}

/**
 * Derive an operation's context contract from its declared signature.
 * `textParams` are the generator's textual params (their names are the
 * manifest's `serviceParams`); `signature` is the same function read by the
 * checker. The two must line up one to one.
 */
export function deriveContextContract(
  textParams: readonly TextualParam[],
  signature: FunctionSignature | null
): DerivedContract {
  const problems: string[] = [];
  if (!signature) {
    return {
      contextSlots: { params: [], payloads: {} },
      injectAuth: [],
      needsOperation: false,
      problems: ["the checker found no exported function of this name"]
    };
  }
  if (signature.params.length !== textParams.length) {
    problems.push(
      `the checker reads ${signature.params.length} params, the parser ${textParams.length}`
    );
  }

  const params: ContextSlot[] = [];
  const payloads: Record<string, PayloadContext> = {};
  const declared = new Set<AuthField>();
  let needsOperation = false;

  signature.params.forEach((param, i) => {
    const text = textParams[i];
    if (!text) return;
    if (param.slot !== "payload") {
      params.push(param.slot);
      return;
    }
    params.push("payload");
    const derived = payloadContext(
      param.payload,
      text.name !== "userId" && PAYLOAD_USER_ID.test(text.typeStr)
    );
    if (derived.problem) {
      problems.push(`param "${text.name}": ${derived.problem}`);
    }
    needsOperation ||= derived.needsOperation;
    const context = derived.context;
    payloads[text.name] = context;
    for (const field of [
      ...context.fields,
      ...(context.discriminator?.present ?? []),
      ...(context.discriminator?.absent ?? []),
      ...(context.byOperation?.create ?? []),
      ...(context.byOperation?.update ?? [])
    ]) {
      declared.add(field);
    }
  });

  return {
    contextSlots: { params, payloads },
    injectAuth: [...declared].sort(byName),
    needsOperation,
    problems
  };
}
