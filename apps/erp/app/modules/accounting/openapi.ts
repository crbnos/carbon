/**
 * Hand-maintained OpenAPI 3.1 document for the v1 integration surface
 * (.ai/specs/2026-07-04-integration-surface.md §5). The zod validators in
 * accounting.models.ts are the source of truth for request shapes; this document
 * mirrors them. Served (rate-limited, unauthenticated) at /api/v1/openapi.json.
 *
 * Availability is noted per operation: endpoints marked "Phase 2" are specified
 * here but not yet wired (they depend on the record-integrity book/export model,
 * the document-approvals JE gate, and the applied integration-surface migration).
 */

import { webhookTopics } from "./accounting.models";

const errorResponse = {
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "string" },
    code: { type: "string" },
    details: { type: "array", items: { type: "object" } }
  }
} as const;

const jsonError = (description: string) => ({
  description,
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/Error" } }
  }
});

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Carbon Accounting Integration API",
    version: "1.0.0",
    description:
      "External read/write surface for accounting integrations (trial-balance " +
      "extracts, JE population export, controlled JE import, and signed webhooks). " +
      "Authenticated with an API key via the `carbon-key` header; scopes map to " +
      "`{module}_{action}` permissions. Rate limited per key (default 1000/h); " +
      "over-limit responses are 429 with `X-RateLimit-*` headers."
  },
  servers: [{ url: "/api/v1" }],
  security: [{ carbonKey: [] }],
  paths: {
    "/accounting/trial-balance": {
      get: {
        operationId: "getTrialBalance",
        summary: "Trial balance (Posted journals only)",
        description:
          "Trial balance rows keyed by stable `accountNumber`. Slice by period or " +
          "date range. `bookId`/`dimension`/`groupBy` are reserved (Phase 2) and " +
          "currently return 400.",
        security: [{ carbonKey: ["accounting_view"] }],
        parameters: [
          { name: "periodId", in: "query", schema: { type: "string" } },
          {
            name: "startDate",
            in: "query",
            schema: { type: "string", format: "date" }
          },
          {
            name: "endDate",
            in: "query",
            schema: { type: "string", format: "date" }
          },
          { name: "bookId", in: "query", schema: { type: "string" } },
          {
            name: "dimension",
            in: "query",
            schema: { type: "array", items: { type: "string" } }
          },
          { name: "groupBy", in: "query", schema: { type: "string" } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 1000, default: 500 }
          }
        ],
        responses: {
          "200": {
            description: "Trial balance page",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TrialBalanceResponse" }
              }
            }
          },
          "400": jsonError(
            "Invalid query, or an unsupported (Phase 2) parameter was supplied"
          ),
          "403": jsonError("API key lacks the accounting_view scope"),
          "429": jsonError("Rate limit exceeded")
        }
      }
    },
    "/accounting/journal-lines/export": {
      get: {
        operationId: "exportJournalLines",
        summary: "Streaming JE population export (Phase 2)",
        description:
          "Full-population journal-line export (CSV or NDJSON) for a bounded " +
          "period. No row cap. Phase 2: depends on the record-integrity export " +
          "column definition and journal book dimension.",
        security: [{ carbonKey: ["accounting_view"] }],
        parameters: [
          { name: "periodId", in: "query", schema: { type: "string" } },
          {
            name: "startDate",
            in: "query",
            schema: { type: "string", format: "date" }
          },
          {
            name: "endDate",
            in: "query",
            schema: { type: "string", format: "date" }
          },
          { name: "bookId", in: "query", schema: { type: "string" } },
          { name: "source", in: "query", schema: { type: "string" } },
          {
            name: "status",
            in: "query",
            schema: { type: "string", default: "Posted" }
          },
          {
            name: "format",
            in: "query",
            schema: { type: "string", enum: ["csv", "ndjson"], default: "csv" }
          }
        ],
        responses: {
          "200": {
            description: "Streamed export (text/csv or application/x-ndjson)"
          },
          "403": jsonError("API key lacks the accounting_view scope"),
          "429": jsonError("Rate limit exceeded")
        }
      }
    },
    "/accounting/journal-entries": {
      post: {
        operationId: "importJournalEntries",
        summary: "Controlled JE import (Phase 2)",
        description:
          "Validated, idempotent, approval- and period-aware JE import (1..100 " +
          "entries). Requires an `Idempotency-Key` header. Phase 2: depends on the " +
          "document-approvals JE gate and the applied migration (journal source " +
          "columns + idempotency table).",
        security: [{ carbonKey: ["accounting_create"] }],
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string" },
            description:
              "Caller-chosen key, scoped (companyId, apiKeyId). Replays return the stored response."
          }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/JournalEntryImport" }
            }
          }
        },
        responses: {
          "200": {
            description: "Per-entry results (replay of a prior Idempotency-Key)"
          },
          "207": {
            description:
              "Per-entry results; one invalid entry does not block siblings"
          },
          "409": jsonError(
            "IDEMPOTENCY_KEY_REUSED or IDEMPOTENCY_KEY_IN_FLIGHT"
          ),
          "422": jsonError("PERIOD_CLOSED, or entry validation failed"),
          "403": jsonError("API key lacks the accounting_create scope"),
          "429": jsonError("Rate limit exceeded")
        }
      }
    },
    "/accounting/journal-entries/{id}": {
      get: {
        operationId: "getImportedJournalEntry",
        summary: "Poll an imported entry's status (Phase 2)",
        security: [{ carbonKey: ["accounting_view"] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Draft / Pending Approval / Posted / Rejected"
          },
          "403": jsonError("API key lacks the accounting_view scope"),
          "404": jsonError("Not found")
        }
      }
    },
    "/webhooks": {
      get: {
        operationId: "listWebhooks",
        summary: "List webhook registrations (Phase 2)",
        security: [{ carbonKey: ["settings_view"] }],
        responses: {
          "200": { description: "Registrations (secret excluded)" },
          "403": jsonError("API key lacks the settings_view scope")
        }
      },
      post: {
        operationId: "registerWebhook",
        summary: "Register a webhook endpoint (Phase 2)",
        description:
          "Creates a registration + one eventSystemSubscription per topic. Secret returned once.",
        security: [{ carbonKey: ["settings_update"] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WebhookRegistration" }
            }
          }
        },
        responses: {
          "201": { description: "Created; `secret` returned once" },
          "403": jsonError("API key lacks the settings_update scope")
        }
      }
    },
    "/webhooks/{id}": {
      delete: {
        operationId: "deleteWebhook",
        summary: "Deactivate a webhook registration (Phase 2)",
        security: [{ carbonKey: ["settings_update"] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          "204": { description: "Deactivated" },
          "403": jsonError("API key lacks the settings_update scope")
        }
      }
    },
    "/openapi.json": {
      get: {
        operationId: "getOpenApiDocument",
        summary: "This OpenAPI 3.1 document",
        security: [],
        responses: {
          "200": { description: "OpenAPI 3.1 document" },
          "429": jsonError("Rate limit exceeded")
        }
      }
    }
  },
  components: {
    securitySchemes: {
      carbonKey: {
        type: "apiKey",
        in: "header",
        name: "carbon-key",
        description:
          "API key. Scopes are `{module}_{action}` (e.g. accounting_view). The key " +
          "principal (its creator) is stamped as the actor on any write."
      }
    },
    schemas: {
      Error: errorResponse,
      TrialBalanceRow: {
        type: "object",
        properties: {
          accountNumber: { type: "string" },
          accountId: { type: "string" },
          accountName: { type: "string" },
          class: { type: ["string", "null"] },
          debits: { type: "number" },
          credits: { type: "number" },
          netChange: { type: "number" },
          currencyCode: { type: "string" }
        }
      },
      TrialBalanceResponse: {
        type: "object",
        properties: {
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/TrialBalanceRow" }
          },
          meta: {
            type: "object",
            properties: {
              companyId: { type: "string" },
              bookId: { type: ["string", "null"] },
              periodId: { type: ["string", "null"] },
              generatedAt: { type: "string", format: "date-time" },
              nextCursor: { type: ["string", "null"] }
            }
          }
        }
      },
      JournalEntryImportLine: {
        type: "object",
        required: ["accountNumber"],
        properties: {
          accountNumber: { type: "string" },
          description: { type: "string" },
          debit: { type: "number", minimum: 0 },
          credit: { type: "number", minimum: 0 },
          dimensions: {
            type: "object",
            additionalProperties: { type: "string" }
          }
        }
      },
      JournalEntryImport: {
        type: "object",
        required: ["entries"],
        properties: {
          entries: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: {
              type: "object",
              required: ["postingDate", "lines"],
              properties: {
                externalId: { type: "string" },
                postingDate: { type: "string", format: "date" },
                description: { type: "string" },
                bookId: { type: ["string", "null"] },
                autoSubmit: { type: "boolean", default: true },
                lines: {
                  type: "array",
                  minItems: 1,
                  maxItems: 500,
                  items: { $ref: "#/components/schemas/JournalEntryImportLine" }
                }
              }
            }
          }
        }
      },
      WebhookRegistration: {
        type: "object",
        required: ["url", "topics"],
        properties: {
          url: { type: "string", format: "uri", description: "https only" },
          topics: {
            type: "array",
            items: { type: "string", enum: [...webhookTopics] },
            minItems: 1
          },
          description: { type: "string" }
        }
      }
    }
  },
  "x-webhook-signature": {
    description:
      "Signed webhooks carry three headers: `carbon-webhook-id` (delivery id), " +
      "`carbon-webhook-timestamp` (ISO 8601 occurrence time), and `carbon-signature` " +
      "= `v1=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>`. Verify the HMAC " +
      "and reject timestamps older than 5 minutes (replay window). The secret is " +
      "the value returned once at registration.",
    topics: [...webhookTopics],
    envelope: {
      id: "string (delivery id)",
      topic: "string",
      companyId: "string",
      occurredAt: "string (ISO 8601)",
      data: "object (per-topic curated projection: ids + status, never line detail)"
    }
  }
} as const;

export type OpenApiDocument = typeof openApiDocument;
