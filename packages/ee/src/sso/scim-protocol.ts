// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The SCIM 2.0 wire format (RFC 7643 / 7644) for Carbon's provisioning
 * endpoint: filters, PATCH operations, resource bodies and responses. Pure — no
 * I/O — so every request shape the identity providers send is pinned by
 * `scim-protocol.test.ts`.
 *
 * The readers are lenient on purpose. Okta's custom (AIW) apps send PUT for
 * every update; Entra sends PATCH with `op` capitalised, booleans as the
 * strings "True"/"False", and — behind its `aadOptscim062020` flag — one
 * no-path `replace` whose value object uses dotted keys. Unknown attributes
 * are ignored rather than refused: an IdP maps many attributes Carbon has no
 * column for (title, phone numbers, the enterprise extension), and refusing
 * them would quarantine the whole provisioning job.
 */

export const SCIM_CONTENT_TYPE = "application/scim+json";

export const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const ENTERPRISE_USER_SCHEMA =
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
export const LIST_RESPONSE_SCHEMA =
  "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const PATCH_OP_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const SERVICE_PROVIDER_CONFIG_SCHEMA =
  "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig";
const RESOURCE_TYPE_SCHEMA =
  "urn:ietf:params:scim:schemas:core:2.0:ResourceType";
const SCHEMA_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Schema";

/** The largest page `GET /Users` and `GET /Groups` return. */
export const SCIM_MAX_RESULTS = 200;
const DEFAULT_COUNT = 100;

/** RFC 7644 §3.12 `scimType` values Carbon answers with. */
export type ScimErrorType =
  | "invalidFilter"
  | "invalidSyntax"
  | "invalidValue"
  | "invalidPath"
  | "uniqueness"
  | "mutability"
  | "noTarget";

export type ScimResult<T> =
  | { ok: true; value: T }
  | { ok: false; detail: string; scimType: ScimErrorType };

function ok<T>(value: T): ScimResult<T> {
  return { ok: true, value };
}

function fail<T>(
  detail: string,
  scimType: ScimErrorType = "invalidValue"
): ScimResult<T> {
  return { ok: false, detail, scimType };
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export function scimJson(
  body: unknown,
  status = 200,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": SCIM_CONTENT_TYPE, ...headers }
  });
}

export function scimError(
  status: number,
  detail: string,
  scimType?: ScimErrorType,
  headers?: Record<string, string>
): Response {
  return scimJson(
    {
      schemas: [ERROR_SCHEMA],
      status: String(status),
      detail,
      ...(scimType ? { scimType } : {})
    },
    status,
    headers
  );
}

export function scimListResponse<T>(
  resources: T[],
  { totalResults, startIndex }: { totalResults: number; startIndex: number }
) {
  return {
    schemas: [LIST_RESPONSE_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources
  };
}

// ---------------------------------------------------------------------------
// Filters and paging
// ---------------------------------------------------------------------------

export type ScimFilterClause = { attribute: string; value: string };

// One `<attribute> <op> <value>` comparison. The value is a quoted string or a
// bare literal (true/false/null/a number), so the operator check below can
// name an unsupported operator instead of failing on the value.
const COMPARISON =
  /^([A-Za-z][\w.:$-]*)\s+([A-Za-z]{2})\s+("(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?)/i;
const AND = /^and\s+/i;

/** Drop a schema URN prefix: `urn:…:core:2.0:User:userName` → `userName`. */
function stripSchemaPrefix(attribute: string): string {
  for (const schema of [USER_SCHEMA, GROUP_SCHEMA]) {
    if (attribute.toLowerCase().startsWith(`${schema.toLowerCase()}:`)) {
      return attribute.slice(schema.length + 1);
    }
  }
  return attribute;
}

function unquote(raw: string): string {
  if (!raw.startsWith('"')) return raw;
  return raw.slice(1, -1).replace(/\\(.)/g, "$1");
}

/**
 * Parse the filters Okta and Entra send: `eq` comparisons joined by `and`
 * (Entra documents only `eq` and `and`; Okta only `userName eq` and
 * `displayName eq`). Anything else is refused as `invalidFilter`, which the
 * IdP shows to its admin, rather than silently matching nothing.
 */
export function parseScimFilter(
  filter: string | null | undefined
): ScimResult<ScimFilterClause[]> {
  const clauses: ScimFilterClause[] = [];
  let rest = (filter ?? "").trim();

  while (rest.length > 0) {
    const match = rest.match(COMPARISON);
    if (!match) {
      return fail(`Unsupported filter: ${filter}`, "invalidFilter");
    }
    const [whole, attribute, operator, raw] = match as unknown as [
      string,
      string,
      string,
      string
    ];
    if (operator.toLowerCase() !== "eq") {
      return fail(
        `Unsupported filter operator "${operator}". Carbon supports "eq" and "and".`,
        "invalidFilter"
      );
    }
    clauses.push({
      attribute: stripSchemaPrefix(attribute),
      value: unquote(raw)
    });

    rest = rest.slice(whole.length).trim();
    if (rest.length === 0) break;
    const and = rest.match(AND);
    if (!and) {
      return fail(`Unsupported filter: ${filter}`, "invalidFilter");
    }
    rest = rest.slice(and[0].length);
  }

  return ok(clauses);
}

function toInteger(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** RFC 7644 §3.4.2.4: 1-based `startIndex`, `count` clamped to the max page. */
export function parsePaging(url: URL): { startIndex: number; count: number } {
  const startIndex = Math.max(
    1,
    toInteger(url.searchParams.get("startIndex"), 1)
  );
  const count = Math.min(
    SCIM_MAX_RESULTS,
    Math.max(0, toInteger(url.searchParams.get("count"), DEFAULT_COUNT))
  );
  return { startIndex, count };
}

// ---------------------------------------------------------------------------
// Shared readers
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A SCIM boolean: `true`/`false`, or Entra's strings "True"/"False". */
export function parseScimBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return null;
}

function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * The email a SCIM `emails` array names: the `primary` entry, else the `work`
 * one, else the first. Entries may be objects (`{ value, type, primary }`) or,
 * from looser clients, bare strings.
 */
export function pickEmail(emails: unknown): string | null {
  if (!Array.isArray(emails)) return null;
  const entries = emails
    .map((entry) =>
      typeof entry === "string"
        ? { value: entry, type: null, primary: false }
        : isObject(entry)
          ? {
              value: readString(entry.value),
              type: readString(entry.type)?.toLowerCase() ?? null,
              primary: parseScimBoolean(entry.primary) === true
            }
          : null
    )
    .filter(
      (
        entry
      ): entry is { value: string; type: string | null; primary: boolean } =>
        entry !== null && typeof entry.value === "string" && entry.value !== ""
    );

  const chosen =
    entries.find((entry) => entry.primary) ??
    entries.find((entry) => entry.type === "work") ??
    entries[0];
  return chosen ? chosen.value.toLowerCase() : null;
}

type Operation = {
  op: "add" | "replace" | "remove";
  path: string | null;
  value: unknown;
};

function readOperations(body: unknown): ScimResult<Operation[]> {
  if (!isObject(body))
    return fail("The body must be a PatchOp object", "invalidSyntax");
  const raw = body.Operations ?? body.operations;
  if (!Array.isArray(raw)) {
    return fail("A PatchOp needs an Operations array", "invalidSyntax");
  }
  const operations: Operation[] = [];
  for (const entry of raw) {
    if (!isObject(entry))
      return fail("Each operation must be an object", "invalidSyntax");
    const op = readString(entry.op)?.toLowerCase();
    if (op !== "add" && op !== "replace" && op !== "remove") {
      return fail(
        `Unsupported PATCH op "${String(entry.op)}"`,
        "invalidSyntax"
      );
    }
    operations.push({ op, path: readString(entry.path), value: entry.value });
  }
  return ok(operations);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export type ScimUserState = {
  userName: string;
  externalId: string | null;
  email: string;
  givenName: string | null;
  familyName: string | null;
  active: boolean;
};

function splitDisplayName(displayName: string | null): {
  givenName: string | null;
  familyName: string | null;
} {
  if (!displayName) return { givenName: null, familyName: null };
  const [first, ...rest] = displayName.split(/\s+/);
  return { givenName: first ?? null, familyName: rest.join(" ") || null };
}

/**
 * Read a full User resource — the body of `POST /Users` and `PUT /Users/{id}`.
 * The email is the `emails` entry `pickEmail` chooses, else `userName` when it
 * is an address. A missing `active` means active (RFC 7643 default).
 */
export function readUserResource(body: unknown): ScimResult<ScimUserState> {
  if (!isObject(body))
    return fail("The body must be a User object", "invalidSyntax");

  const userName = readString(body.userName);
  if (!userName) return fail("userName is required");

  const name = isObject(body.name) ? body.name : {};
  let givenName = readString(name.givenName);
  let familyName = readString(name.familyName);
  if (!givenName && !familyName) {
    ({ givenName, familyName } = splitDisplayName(
      readString(body.displayName)
    ));
  }

  const email =
    pickEmail(body.emails) ??
    (isEmailAddress(userName) ? userName.toLowerCase() : null);
  if (!email || !isEmailAddress(email)) {
    return fail("A user needs an email address in emails or userName");
  }

  let active = true;
  if (body.active !== undefined && body.active !== null) {
    const parsed = parseScimBoolean(body.active);
    if (parsed === null) return fail("active must be true or false");
    active = parsed;
  }

  return ok({
    userName,
    externalId: readString(body.externalId),
    email,
    givenName,
    familyName,
    active
  });
}

const EMAIL_VALUE_PATH = /^emails(\[[^\]]*\])?(\.value)?$/i;

function setUserAttribute(
  state: ScimUserState,
  rawPath: string,
  value: unknown,
  op: Operation["op"]
): ScimResult<ScimUserState> {
  const path = stripSchemaPrefix(rawPath);
  const lower = path.toLowerCase();

  // The enterprise extension (department, employeeNumber, manager) has no
  // Carbon column; accept and ignore it.
  if (lower.startsWith(ENTERPRISE_USER_SCHEMA.toLowerCase())) return ok(state);

  if (lower === "active") {
    if (op === "remove") return ok(state);
    const active = parseScimBoolean(value);
    if (active === null) return fail("active must be true or false");
    return ok({ ...state, active });
  }

  if (lower === "username") {
    const userName = readString(value);
    if (op === "remove" || !userName) {
      return fail("userName cannot be removed", "mutability");
    }
    return ok({ ...state, userName });
  }

  if (lower === "externalid") {
    return ok({
      ...state,
      externalId: op === "remove" ? null : readString(value)
    });
  }

  if (lower === "name") {
    if (op === "remove")
      return ok({ ...state, givenName: null, familyName: null });
    if (!isObject(value)) return fail("name must be an object");
    let next = state;
    for (const [key, sub] of Object.entries(value)) {
      const result = setUserAttribute(next, `name.${key}`, sub, op);
      if (!result.ok) return result;
      next = result.value;
    }
    return ok(next);
  }

  if (lower === "name.givenname") {
    return ok({
      ...state,
      givenName: op === "remove" ? null : readString(value)
    });
  }

  if (lower === "name.familyname") {
    return ok({
      ...state,
      familyName: op === "remove" ? null : readString(value)
    });
  }

  if (EMAIL_VALUE_PATH.test(path)) {
    // Carbon keeps one email per person; removing it leaves the stored one.
    if (op === "remove") return ok(state);
    const email = Array.isArray(value)
      ? pickEmail(value)
      : isObject(value)
        ? pickEmail([value])
        : (readString(value)?.toLowerCase() ?? null);
    if (!email || !isEmailAddress(email)) {
      return fail("emails must hold a valid email address");
    }
    return ok({ ...state, email });
  }

  // displayName, title, phoneNumbers, addresses, locale and the rest have no
  // Carbon column. Ignore them so the IdP's default mappings keep working.
  return ok(state);
}

/**
 * Apply a `PATCH /Users/{id}` body to the stored state. Handles Okta's no-path
 * `{ "active": false }`, Entra's default `Replace` + `"False"`, and Entra's
 * `aadOptscim062020` shape (one no-path `replace` with dotted keys).
 */
export function applyUserPatch(
  state: ScimUserState,
  body: unknown
): ScimResult<ScimUserState> {
  const operations = readOperations(body);
  if (!operations.ok) return operations;

  let next = state;
  for (const operation of operations.value) {
    if (operation.path === null) {
      if (operation.op === "remove") {
        return fail("A remove operation needs a path", "noTarget");
      }
      if (!isObject(operation.value)) {
        return fail("An operation without a path needs an object value");
      }
      for (const [key, value] of Object.entries(operation.value)) {
        const result = setUserAttribute(next, key, value, operation.op);
        if (!result.ok) return result;
        next = result.value;
      }
      continue;
    }

    const result = setUserAttribute(
      next,
      operation.path,
      operation.value,
      operation.op
    );
    if (!result.ok) return result;
    next = result.value;
  }

  return ok(next);
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export type ScimGroupState = {
  displayName: string;
  externalId: string | null;
  memberIds: string[];
};

function readMemberIds(value: unknown): string[] {
  const entries = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];
  const ids = entries
    .map((entry) =>
      typeof entry === "string"
        ? readString(entry)
        : isObject(entry)
          ? readString(entry.value)
          : null
    )
    .filter((id): id is string => id !== null);
  return [...new Set(ids)];
}

/** Read a full Group resource — the body of `POST /Groups` and `PUT /Groups/{id}`. */
export function readGroupResource(body: unknown): ScimResult<ScimGroupState> {
  if (!isObject(body))
    return fail("The body must be a Group object", "invalidSyntax");
  const displayName = readString(body.displayName);
  if (!displayName) return fail("displayName is required");
  return ok({
    displayName,
    externalId: readString(body.externalId),
    memberIds: readMemberIds(body.members)
  });
}

const MEMBER_FILTER_PATH =
  /^members\[\s*value\s+eq\s+"((?:[^"\\]|\\.)*)"\s*\]$/i;

function addMembers(state: ScimGroupState, ids: string[]): ScimGroupState {
  return { ...state, memberIds: [...new Set([...state.memberIds, ...ids])] };
}

function removeMembers(state: ScimGroupState, ids: string[]): ScimGroupState {
  const drop = new Set(ids);
  return { ...state, memberIds: state.memberIds.filter((id) => !drop.has(id)) };
}

/**
 * Apply a `PATCH /Groups/{id}` body: member add / remove / replace (Okta sends
 * up to 1000 members per request), removal by `members[value eq "id"]`
 * (Entra's flag shape), and a rename by path or by a no-path value object
 * (Okta sends `{ id, displayName }`).
 */
export function applyGroupPatch(
  state: ScimGroupState,
  body: unknown
): ScimResult<ScimGroupState> {
  const operations = readOperations(body);
  if (!operations.ok) return operations;

  let next = state;
  for (const { op, path: rawPath, value } of operations.value) {
    if (rawPath === null) {
      if (op === "remove")
        return fail("A remove operation needs a path", "invalidPath");
      if (!isObject(value))
        return fail("An operation without a path needs an object value");
      for (const [key, sub] of Object.entries(value)) {
        const lower = stripSchemaPrefix(key).toLowerCase();
        if (lower === "displayname") {
          const displayName = readString(sub);
          if (!displayName) return fail("displayName cannot be empty");
          next = { ...next, displayName };
        } else if (lower === "externalid") {
          next = { ...next, externalId: readString(sub) };
        } else if (lower === "members") {
          next =
            op === "add"
              ? addMembers(next, readMemberIds(sub))
              : { ...next, memberIds: readMemberIds(sub) };
        }
      }
      continue;
    }

    const path = stripSchemaPrefix(rawPath);
    const lower = path.toLowerCase();
    const filtered = path.match(MEMBER_FILTER_PATH);

    if (filtered) {
      if (op !== "remove") {
        return fail(
          "A filtered members path supports only remove",
          "invalidPath"
        );
      }
      next = removeMembers(next, [unquote(`"${filtered[1]}"`)]);
    } else if (lower === "members") {
      if (op === "add") next = addMembers(next, readMemberIds(value));
      else if (op === "replace")
        next = { ...next, memberIds: readMemberIds(value) };
      else
        next =
          value === undefined || value === null
            ? { ...next, memberIds: [] }
            : removeMembers(next, readMemberIds(value));
    } else if (lower === "displayname") {
      const displayName = readString(value);
      if (op === "remove" || !displayName) {
        return fail("displayName cannot be removed", "mutability");
      }
      next = { ...next, displayName };
    } else if (lower === "externalid") {
      next = {
        ...next,
        externalId: op === "remove" ? null : readString(value)
      };
    }
    // Other group attributes have no Carbon column; ignore them.
  }

  return ok(next);
}

// ---------------------------------------------------------------------------
// Resource bodies
// ---------------------------------------------------------------------------

export type ScimUserRow = {
  id: string;
  userName: string;
  externalId: string | null;
  email: string;
  givenName: string | null;
  familyName: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
};

export type ScimGroupRow = {
  id: string;
  displayName: string;
  externalId: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export function toScimUser(row: ScimUserRow, baseUrl: string) {
  const formatted = [row.givenName, row.familyName].filter(Boolean).join(" ");
  return {
    schemas: [USER_SCHEMA],
    id: row.id,
    ...(row.externalId ? { externalId: row.externalId } : {}),
    userName: row.userName,
    name: {
      ...(row.givenName ? { givenName: row.givenName } : {}),
      ...(row.familyName ? { familyName: row.familyName } : {}),
      ...(formatted ? { formatted } : {})
    },
    displayName: formatted || row.userName,
    emails: [{ value: row.email, type: "work", primary: true }],
    active: row.active,
    meta: {
      resourceType: "User",
      created: row.createdAt,
      lastModified: row.updatedAt ?? row.createdAt,
      location: `${baseUrl}/Users/${row.id}`
    }
  };
}

/** `members` is null when the request excluded it (`excludedAttributes=members`). */
export function toScimGroup(
  row: ScimGroupRow,
  members: { value: string; display: string }[] | null,
  baseUrl: string
) {
  return {
    schemas: [GROUP_SCHEMA],
    id: row.id,
    ...(row.externalId ? { externalId: row.externalId } : {}),
    displayName: row.displayName,
    ...(members ? { members } : {}),
    meta: {
      resourceType: "Group",
      created: row.createdAt,
      lastModified: row.updatedAt ?? row.createdAt,
      location: `${baseUrl}/Groups/${row.id}`
    }
  };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export function serviceProviderConfig(baseUrl: string) {
  return {
    schemas: [SERVICE_PROVIDER_CONFIG_SCHEMA],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: SCIM_MAX_RESULTS },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description:
          "The SCIM token from Settings → Security → Provisioning in Carbon.",
        primary: true
      }
    ],
    meta: {
      resourceType: "ServiceProviderConfig",
      location: `${baseUrl}/ServiceProviderConfig`
    }
  };
}

export function resourceTypes(baseUrl: string) {
  const types = [
    {
      schemas: [RESOURCE_TYPE_SCHEMA],
      id: "User",
      name: "User",
      endpoint: "/Users",
      schema: USER_SCHEMA,
      schemaExtensions: [{ schema: ENTERPRISE_USER_SCHEMA, required: false }],
      meta: {
        resourceType: "ResourceType",
        location: `${baseUrl}/ResourceTypes/User`
      }
    },
    {
      schemas: [RESOURCE_TYPE_SCHEMA],
      id: "Group",
      name: "Group",
      endpoint: "/Groups",
      schema: GROUP_SCHEMA,
      meta: {
        resourceType: "ResourceType",
        location: `${baseUrl}/ResourceTypes/Group`
      }
    }
  ];
  return scimListResponse(types, { totalResults: types.length, startIndex: 1 });
}

function attribute(
  name: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    name,
    type: "string",
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: "readWrite",
    returned: "default",
    uniqueness: "none",
    ...extra
  };
}

export function schemas() {
  const definitions = [
    {
      schemas: [SCHEMA_SCHEMA],
      id: USER_SCHEMA,
      name: "User",
      attributes: [
        attribute("userName", { required: true, uniqueness: "server" }),
        attribute("externalId", { caseExact: true }),
        attribute("name", {
          type: "complex",
          subAttributes: [attribute("givenName"), attribute("familyName")]
        }),
        attribute("displayName"),
        attribute("emails", {
          type: "complex",
          multiValued: true,
          subAttributes: [
            attribute("value"),
            attribute("type"),
            attribute("primary", { type: "boolean" })
          ]
        }),
        attribute("active", { type: "boolean" })
      ]
    },
    {
      schemas: [SCHEMA_SCHEMA],
      id: GROUP_SCHEMA,
      name: "Group",
      attributes: [
        attribute("displayName", { required: true, uniqueness: "server" }),
        attribute("externalId", { caseExact: true }),
        attribute("members", {
          type: "complex",
          multiValued: true,
          subAttributes: [attribute("value"), attribute("display")]
        })
      ]
    }
  ];
  return scimListResponse(definitions, {
    totalResults: definitions.length,
    startIndex: 1
  });
}
