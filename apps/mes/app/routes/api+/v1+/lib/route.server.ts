// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  ApiPermissions,
  ApiUser,
  ApiUserDeps
} from "@carbon/auth/api-user.server";
import {
  API_VERSIONS_HEADER,
  ApiError,
  apiErrorResponse,
  requireApiUser
} from "@carbon/auth/api-user.server";
import { getLogger } from "@carbon/logger";
import { compareAppVersion, HEADERS } from "@carbon/mes-core";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { IDEMPOTENCY_HEADER, withIdempotency } from "./idempotency.server";
import { API_VERSIONS, MIN_APP_VERSION } from "./version.server";

const log = getLogger("mes-api");

/**
 * The one wrapper every `/api/v1` endpoint goes through, so that the version
 * check, the JSON parse, the auth gate, the idempotency window and the error
 * shape cannot be forgotten on a single route.
 *
 * Note there are NO CORS headers anywhere in this API: it exists for the native
 * app, not for browsers. `securityMiddleware` already lets a request with
 * neither `Origin` nor `Sec-Fetch-Site` through, which is what a native client
 * sends, so no CROSS_ORIGIN_ENDPOINTS entry is needed either.
 */

export type ApiContext<Body> = {
  request: Request;
  params: Record<string, string | undefined>;
  body: Body;
  /** Null only on a `public: true` route. */
  user: ApiUser | null;
};

type Handler<Body> = (
  ctx: ApiContext<Body>
) => Promise<Response | Record<string, unknown> | unknown[]>;

export type ApiRouteOptions<Body> = {
  method: "GET" | "POST";
  /** Pre-sign-in endpoints (the three `auth/*` calls). */
  public?: boolean;
  permissions?: ApiPermissions;
  body?: z.ZodType<Body>;
  /**
   * Every authenticated POST requires an `Idempotency-Key` unless it is turned
   * off here. Turn it off only for a call that writes no business row (the
   * console token endpoints), never for a command.
   */
  idempotent?: boolean;
  deps?: ApiUserDeps;
};

export function json(
  data: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      [API_VERSIONS_HEADER]: API_VERSIONS,
      ...init.headers
    }
  });
}

function toResponse(result: Awaited<ReturnType<Handler<unknown>>>): Response {
  if (result instanceof Response) {
    // A handler that built its own Response still owes the version header.
    if (!result.headers.has(API_VERSIONS_HEADER)) {
      result.headers.set(API_VERSIONS_HEADER, API_VERSIONS);
    }
    return result;
  }
  return json(result);
}

/** 426 to an app older than this server will talk to. */
function assertAppVersion(request: Request) {
  const version = request.headers.get(HEADERS.appVersion);
  // Absent is allowed on purpose: curl and the dev tools send no version, and
  // the app always does. Only a version we can READ and that is too OLD is
  // refused.
  if (version && compareAppVersion(version, MIN_APP_VERSION) < 0) {
    throw new ApiError(
      426,
      "update_required",
      "Update Carbon MES to keep working"
    );
  }
}

async function parseBody<Body>(
  request: Request,
  schema: z.ZodType<Body> | undefined,
  raw: string
): Promise<Body> {
  if (!schema) return undefined as Body;

  let parsed: unknown;
  try {
    parsed = raw.length ? JSON.parse(raw) : {};
  } catch {
    throw new ApiError(400, "validation_failed", "Could not read the request");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const flat = result.error.flatten();
    throw new ApiError(
      400,
      "validation_failed",
      "Check the highlighted fields",
      flat.fieldErrors as Record<string, string[]>
    );
  }
  return result.data;
}

export function apiRoute<Body = undefined>(
  options: ApiRouteOptions<Body>,
  handler: Handler<Body>
) {
  return async ({
    request,
    params
  }: LoaderFunctionArgs | ActionFunctionArgs) => {
    try {
      if (request.method !== options.method) {
        throw new ApiError(
          405,
          "validation_failed",
          `Use ${options.method} for this endpoint`
        );
      }

      assertAppVersion(request);

      // Read the body ONCE: the idempotency fingerprint and the zod parse both
      // need it, and a Request body can only be consumed a single time.
      const raw =
        options.method === "POST" && options.body ? await request.text() : "";
      const body = await parseBody(request, options.body, raw);

      const user = options.public
        ? null
        : await requireApiUser(
            request,
            options.permissions ?? {},
            options.deps
          );

      const run = async () =>
        toResponse(await handler({ request, params, body, user }));

      const needsIdempotency =
        options.method === "POST" &&
        !options.public &&
        options.idempotent !== false;

      if (!needsIdempotency || !user) return await run();

      const key = request.headers.get(IDEMPOTENCY_HEADER)?.trim();
      if (!key || key.length > 128) {
        throw new ApiError(
          400,
          "idempotency_key_required",
          "This request needs an Idempotency-Key header"
        );
      }

      return await withIdempotency(
        {
          companyId: user.companyId,
          sessionUserId: user.sessionUserId,
          key,
          method: request.method,
          path: new URL(request.url).pathname,
          body: raw
        },
        run
      );
    } catch (err) {
      if (err instanceof ApiError) return apiErrorResponse(err);
      if (err instanceof z.ZodError) {
        return apiErrorResponse(
          new ApiError(400, "validation_failed", "Check the request body")
        );
      }
      // A thrown Response is how React Router signals a redirect or a 404 from
      // shared server code; pass it through rather than reporting a 500.
      if (err instanceof Response) {
        if (!err.headers.has(API_VERSIONS_HEADER)) {
          err.headers.set(API_VERSIONS_HEADER, API_VERSIONS);
        }
        return err;
      }
      log.error("Unhandled MES API error", {
        error: err,
        path: new URL(request.url).pathname
      });
      return apiErrorResponse(
        new ApiError(500, "internal", "Something went wrong on the server")
      );
    }
  };
}
