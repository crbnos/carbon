// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The OpenAPI document options for the Carbon API spec — extracted from the
// openapi.json route so the mechanics test asserts on the REAL options rather
// than a copy that could drift.

import { getAppUrl } from "@carbon/env";
import type { OpenAPIGeneratorGenerateOptions } from "@orpc/openapi";

export function specOptions(): OpenAPIGeneratorGenerateOptions {
  return {
    info: {
      title: "Carbon API",
      version: "1.0.0",
      description:
        "Carbon's service-layer API — read and write your manufacturing data the safe way."
    },
    servers: [{ url: `${getAppUrl() || ""}/api/v1` }],
    // ONE documented way in: `Authorization: Bearer crbn_…` — the convention every
    // doc sample and the rest.carbon.ms proxy use, and what generated SDKs will
    // configure. The server also accepts the raw internal `carbon-key` header
    // (authenticate.server.ts) as a compatibility alias, deliberately NOT declared
    // here: a spec that says "either way" gives every generated client two auth
    // stories instead of one.
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "A Carbon API key (`crbn_…`) sent as a Bearer token."
        }
      }
    }
  };
}

const ERROR_SCHEMA = {
  type: "object",
  description:
    "An operation's refusal. `message` is written for a person; `data.category` names the kind of refusal.",
  properties: {
    defined: { type: "boolean" },
    code: { type: "string", examples: ["NOT_FOUND"] },
    status: { type: "integer", examples: [404] },
    message: { type: "string", examples: ["Job not found"] },
    data: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: [
            "validation",
            "entitlement",
            "forbidden",
            "notFound",
            "conflict",
            "rule",
            "rateLimited",
            "internal",
            "unavailable"
          ]
        }
      }
    }
  },
  required: ["code", "status", "message"]
} as const;

const json = {
  "application/json": { schema: { $ref: "#/components/schemas/Error" } }
};
const text = { "text/plain": { schema: { type: "string" } } };

/**
 * The responses besides 200. An operation's refusal is a JSON `Error`; the
 * API key check runs before any operation and answers in plain text.
 */
const ERROR_RESPONSES = {
  "400": {
    description: "The input is invalid; `message` names each field.",
    content: json
  },
  "401": { description: "No API key, or not a valid one.", content: text },
  "402": {
    description: "The company's plan does not include this.",
    content: json
  },
  "403": {
    description:
      "The key or its creator lacks the permission (JSON from the operation, text from the key's scopes).",
    content: { ...json, ...text }
  },
  "404": {
    description: "The record does not exist, or belongs to another company.",
    content: json
  },
  "409": {
    description: "The record changed since it was read; read it again.",
    content: json
  },
  "422": {
    description: "Refused by a business rule; `message` says which.",
    content: json
  },
  "429": {
    description: "Rate limited; wait for `Retry-After` seconds.",
    content: text
  },
  "500": {
    description: "An internal failure; the detail is logged, not returned.",
    content: json
  },
  "503": {
    description: "A service the operation needs is unavailable; retry.",
    content: json
  }
} as const;

/**
 * Adds the shared `Error` schema and every error response to each operation;
 * a response the operation already defines is kept.
 */
export function withErrorResponses<
  T extends {
    paths?: Record<string, Record<string, { responses?: object }>>;
    components?: { schemas?: Record<string, unknown> };
  }
>(spec: T): T {
  spec.components = {
    ...spec.components,
    schemas: { ...spec.components?.schemas, Error: ERROR_SCHEMA }
  };
  for (const item of Object.values(spec.paths ?? {})) {
    for (const operation of Object.values(item)) {
      operation.responses = { ...ERROR_RESPONSES, ...operation.responses };
    }
  }
  return spec;
}
