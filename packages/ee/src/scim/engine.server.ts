// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The SCIM 2.0 server behind `/scim/v2` (spec:
 * `.ai/specs/2026-10-30-scim-provisioning.md`): the token names the company,
 * then the entitlement lock (`requireEntitlement(…, "SCIM")`) runs inside
 * commercial code on every request. The ERP route only hands the request over.
 */

import { hashApiKey } from "@carbon/auth/auth.server";
import type { KyselyDatabase } from "@carbon/database/client";
import { getAppUrl } from "@carbon/env";
import { Ratelimit, redis } from "@carbon/kv";
import { type Kysely, sql } from "kysely";
import { EntitlementError, requireEntitlement } from "../entitlements.server";
import {
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  patchGroup,
  replaceGroup
} from "./groups.server";
import {
  matchScimRoute,
  readBearerToken,
  resourceTypes,
  schemas,
  scimError,
  scimJson,
  serviceProviderConfig
} from "./protocol";
import {
  type Ctx,
  logger,
  SCIM_TOKEN_PREFIX,
  type ScimConnectionRow,
  type ScimDeps
} from "./shared.server";
import {
  createUser,
  deleteUser,
  getUser,
  listUsers,
  patchUser,
  replaceUser
} from "./users.server";

const REQUESTS_PER_MINUTE = 600;
const RETRY_AFTER_SECONDS = "60";

// Made on the first SCIM request, not at import: the settings screens and the
// users module import the SCIM package only for its reads.
let ratelimit: Ratelimit | undefined;
function scimRatelimit(): Ratelimit {
  ratelimit ??= new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(REQUESTS_PER_MINUTE, "1 m")
  });
  return ratelimit;
}

function internalError(): Response {
  return scimError(500, "Carbon could not complete the request. Try again.");
}

function unauthorized(): Response {
  return scimError(401, "A valid SCIM bearer token is required.");
}

/**
 * Answer one SCIM request. Never throws: an unexpected failure is logged and
 * answered 500, which Okta shows on its task and Entra retries next cycle.
 */
export async function handleScimRequest(
  request: Request,
  deps: ScimDeps
): Promise<Response> {
  try {
    return await handle(request, deps);
  } catch (err) {
    logger.error("SCIM request failed", {
      error: err,
      method: request.method,
      path: new URL(request.url).pathname
    });
    return internalError();
  }
}

async function handle(request: Request, deps: ScimDeps): Promise<Response> {
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token?.startsWith(SCIM_TOKEN_PREFIX)) return unauthorized();

  const lookup = await deps.serviceRole
    .from("scimConnection")
    .select("*")
    .eq("tokenHash", hashApiKey(token))
    .maybeSingle();
  if (lookup.error) {
    logger.error("Failed to read the SCIM connection", { error: lookup.error });
    return internalError();
  }
  if (!lookup.data) return unauthorized();

  const connection = lookup.data;
  const url = new URL(request.url);
  const response = await handleForCompany(request, url, deps, connection);
  logger.info("SCIM request", {
    companyId: connection.companyId,
    method: request.method,
    path: url.pathname,
    status: response.status
  });
  return response;
}

async function handleForCompany(
  request: Request,
  url: URL,
  deps: ScimDeps,
  connection: ScimConnectionRow
): Promise<Response> {
  try {
    await requireEntitlement(deps.serviceRole, connection.companyId, "SCIM");
  } catch (err) {
    if (err instanceof EntitlementError) {
      return scimError(
        403,
        "SCIM provisioning requires the Business plan. Ask an administrator of the Carbon company to upgrade."
      );
    }
    throw err;
  }

  const { success } = await scimRatelimit().limit(`scim:${connection.id}`);
  if (!success) {
    return scimError(429, "Too many SCIM requests. Retry later.", undefined, {
      "Retry-After": RETRY_AFTER_SECONDS
    });
  }

  await touchConnection(deps.db, connection);

  const ctx: Ctx = {
    ...deps,
    connection,
    companyId: connection.companyId,
    baseUrl: `${getAppUrl()}/scim/v2`
  };
  const route = matchScimRoute(url.pathname);
  if (!route) return scimError(404, "This SCIM endpoint does not exist.");
  const method = request.method.toUpperCase();
  const { id } = route;

  switch (route.resource) {
    case "ServiceProviderConfig":
      if (method !== "GET") return methodNotAllowed();
      return scimJson(serviceProviderConfig(ctx.baseUrl));
    case "ResourceTypes": {
      if (method !== "GET") return methodNotAllowed();
      const list = resourceTypes(ctx.baseUrl);
      if (!id) return scimJson(list);
      const one = list.Resources.find((type) => type.id === id);
      return one ? scimJson(one) : scimError(404, "Unknown resource type.");
    }
    case "Schemas": {
      if (method !== "GET") return methodNotAllowed();
      const list = schemas();
      if (!id) return scimJson(list);
      const one = list.Resources.find((schema) => schema.id === id);
      return one ? scimJson(one) : scimError(404, "Unknown schema.");
    }
    case "Users":
      if (!id) {
        if (method === "GET") return listUsers(ctx, url);
        if (method === "POST") {
          return withBody(request, (body) => createUser(ctx, body));
        }
        return methodNotAllowed();
      }
      if (method === "GET") return getUser(ctx, id);
      if (method === "PUT") {
        return withBody(request, (body) => replaceUser(ctx, id, body));
      }
      if (method === "PATCH") {
        return withBody(request, (body) => patchUser(ctx, id, body));
      }
      if (method === "DELETE") return deleteUser(ctx, id);
      return methodNotAllowed();
    case "Groups":
      if (!id) {
        if (method === "GET") return listGroups(ctx, url);
        if (method === "POST") {
          return withBody(request, (body) => createGroup(ctx, body));
        }
        return methodNotAllowed();
      }
      if (method === "GET") return getGroup(ctx, id, url);
      if (method === "PUT") {
        return withBody(request, (body) => replaceGroup(ctx, id, body));
      }
      if (method === "PATCH") {
        return withBody(request, (body) => patchGroup(ctx, id, body));
      }
      if (method === "DELETE") return deleteGroup(ctx, id);
      return methodNotAllowed();
  }
}

function methodNotAllowed(): Response {
  return scimError(405, "This method is not supported on this endpoint.");
}

async function withBody(
  request: Request,
  handler: (body: unknown) => Promise<Response>
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return scimError(
      400,
      "The request body is not valid JSON.",
      "invalidSyntax"
    );
  }
  return handler(body);
}

/** Record the last request, at most once a minute (the settings card shows it). */
async function touchConnection(
  db: Kysely<KyselyDatabase>,
  connection: ScimConnectionRow
): Promise<void> {
  try {
    await db
      .updateTable("scimConnection")
      .set({ lastRequestAt: sql`now()` })
      .where("id", "=", connection.id)
      .where("companyId", "=", connection.companyId)
      .where((eb) =>
        eb.or([
          eb("lastRequestAt", "is", null),
          eb("lastRequestAt", "<", sql<string>`now() - interval '1 minute'`)
        ])
      )
      .execute();
  } catch (err) {
    logger.error("Failed to record the SCIM request time", {
      error: err,
      companyId: connection.companyId
    });
  }
}
