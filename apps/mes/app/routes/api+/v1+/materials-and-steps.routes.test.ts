// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requireApiUser } from "@carbon/auth/api-user.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failed, ok } from "~/services/api-result.server";
import {
  issueMaterial,
  issueTrackedEntities,
  unconsumeTrackedEntities
} from "~/services/commands.materials.server";
import {
  addOperationNote,
  deleteStepRecord,
  printLabel,
  raiseQualityIssue,
  recordStep
} from "~/services/commands.steps.server";

/**
 * The eight materials / steps / quality / print endpoints in one file.
 *
 * They are siblings over two command modules and share every behaviour under
 * test — the `apiRoute` gates and the `CommandResult` → status mapping — so one
 * table-driven file says more than eight near-identical ones, and a new
 * endpoint is one row rather than a new file to copy wrong.
 */

// The real module's auth chain reaches `@carbon/content`'s glossary, whose
// lingui `msg` macro vitest does not transform — so `ApiError` and
// `apiErrorResponse` (both self-contained) are mirrored here. The status and
// `error.code` the tests assert are exactly what the real pair produces.
vi.mock("@carbon/auth/api-user.server", () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
      readonly fields?: Record<string, string[]>,
      readonly details?: unknown
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    ApiError,
    API_VERSIONS_HEADER: "carbon-api",
    API_VERSIONS: "1",
    apiErrorResponse: (err: ApiError) =>
      new Response(
        JSON.stringify({
          error: {
            code: err.code,
            message: err.message,
            ...(err.fields && { fields: err.fields }),
            ...(err.details !== undefined && { details: err.details })
          }
        }),
        {
          status: err.status,
          headers: { "Content-Type": "application/json", "carbon-api": "1" }
        }
      ),
    requireApiUser: vi.fn()
  };
});

// The idempotency window needs a live Redis. The header check it hangs off
// lives in `apiRoute` and is still exercised below — which is the part that
// matters, because none of these commands is idempotent: a retried issue would
// consume stock twice.
vi.mock("./lib/idempotency.server", () => ({
  IDEMPOTENCY_HEADER: "idempotency-key",
  REPLAYED_HEADER: "idempotent-replayed",
  withIdempotency: vi.fn(async (_args: unknown, run: () => Promise<Response>) =>
    run()
  )
}));

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn(() => ({}))
}));

vi.mock("~/services/commands.materials.server", () => ({
  issueMaterial: vi.fn(),
  issueTrackedEntities: vi.fn(),
  unconsumeTrackedEntities: vi.fn()
}));

vi.mock("~/services/commands.steps.server", () => ({
  recordStep: vi.fn(),
  deleteStepRecord: vi.fn(),
  addOperationNote: vi.fn(),
  raiseQualityIssue: vi.fn(),
  printLabel: vi.fn()
}));

const OPERATOR = "user-operator";
const TERMINAL = "user-terminal";
const COMPANY = "comp-1";
const LOCATION = "loc-1";

type RouteModule = {
  action: (args: {
    request: Request;
    params: Record<string, string | undefined>;
    context: unknown;
  }) => Promise<Response>;
  loader: (args: {
    request: Request;
    params: Record<string, string | undefined>;
    context: unknown;
  }) => Promise<Response>;
};

type Endpoint = {
  name: string;
  path: string;
  load: () => Promise<RouteModule>;
  params: Record<string, string>;
  /** A body the route's schema accepts. `null` for a route with no body. */
  valid: unknown;
  /** A body the route's schema must REJECT. `null` when the route has none. */
  invalid: unknown;
  command: ReturnType<typeof vi.fn>;
  success: unknown;
  /** Only this one needs a permission beyond "employee of the company". */
  permissions?: Record<string, string>;
  /** Only `print` requires the location header. */
  needsLocation?: boolean;
};

const ENDPOINTS: Endpoint[] = [
  {
    name: "materials/issue",
    path: "/api/v1/operations/op-1/materials/issue",
    load: () => import("./operations.$id.materials.issue") as never,
    params: { id: "op-1" },
    valid: {
      itemId: "item-1",
      jobOperationId: "op-1",
      quantity: 2,
      adjustmentType: "Positive Adjmt."
    },
    invalid: { itemId: "item-1", jobOperationId: "op-1", quantity: 2 },
    command: issueMaterial as never,
    success: ok(null)
  },
  {
    name: "materials/issue-tracked",
    path: "/api/v1/operations/op-1/materials/issue-tracked",
    load: () => import("./operations.$id.materials.issue-tracked") as never,
    params: { id: "op-1" },
    valid: { jobOperationId: "op-1", children: [] },
    invalid: { jobOperationId: "op-1" },
    command: issueTrackedEntities as never,
    success: ok({ message: "Issued", splitEntities: [], warning: undefined })
  },
  {
    name: "materials/unconsume",
    path: "/api/v1/operations/op-1/materials/unconsume",
    load: () => import("./operations.$id.materials.unconsume") as never,
    params: { id: "op-1" },
    valid: { jobOperationId: "op-1", children: [] },
    invalid: { jobOperationId: "op-1" },
    command: unconsumeTrackedEntities as never,
    success: ok(null)
  },
  {
    name: "step-records",
    path: "/api/v1/operations/op-1/step-records",
    load: () => import("./operations.$id.step-records") as never,
    params: { id: "op-1" },
    valid: { index: 0, jobOperationStepId: "step-1" },
    invalid: { index: 0 },
    command: recordStep as never,
    success: ok(null)
  },
  {
    name: "step-records/:id/delete",
    path: "/api/v1/step-records/rec-1/delete",
    load: () => import("./step-records.$id.delete") as never,
    params: { id: "rec-1" },
    valid: null,
    invalid: null,
    command: deleteStepRecord as never,
    success: ok(null)
  },
  {
    name: "notes",
    path: "/api/v1/operations/op-1/notes",
    load: () => import("./operations.$id.notes") as never,
    params: { id: "op-1" },
    valid: { note: "Fixture is loose" },
    invalid: { note: "" },
    command: addOperationNote as never,
    success: ok({ id: "note-1", createdAt: "2026-10-02T00:00:00.000Z" })
  },
  {
    name: "quality-issues",
    path: "/api/v1/quality-issues",
    load: () => import("./quality-issues") as never,
    params: {},
    valid: { jobOperationId: "op-1", description: "Burr on edge" },
    invalid: { description: "Burr on edge" },
    command: raiseQualityIssue as never,
    success: ok({ id: "ncr-1" }),
    permissions: { create: "quality" }
  },
  {
    name: "print",
    path: "/api/v1/print",
    load: () => import("./print") as never,
    params: {},
    valid: { sourceDocument: "Job Operation", sourceDocumentId: "op-1" },
    invalid: { sourceDocument: "Job Operation" },
    command: printLabel as never,
    success: ok(null),
    needsLocation: true
  }
];

function signedIn() {
  vi.mocked(requireApiUser).mockResolvedValue({
    companyId: COMPANY,
    userId: OPERATOR,
    sessionUserId: TERMINAL,
    consoleMode: true,
    accessToken: "token",
    email: "op@example.com",
    claims: { role: "employee", permissions: {} },
    client: {} as never
  } as never);
}

async function call(
  endpoint: Endpoint,
  opts: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
) {
  const mod = await endpoint.load();
  const method = opts.method ?? "POST";
  const body = opts.body === undefined ? endpoint.valid : opts.body;
  const request = new Request(`http://localhost${endpoint.path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "idempotency-key": "key-1",
      ...(endpoint.needsLocation ? { "x-carbon-location": LOCATION } : {}),
      ...opts.headers
    },
    ...(method === "POST" && body !== null
      ? { body: JSON.stringify(body) }
      : {})
  });
  const handler = method === "GET" ? mod.loader : mod.action;
  return handler({ request, params: endpoint.params, context: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
});

describe.each(ENDPOINTS)("$name", (endpoint) => {
  it("runs the command and answers 200 with carbon-api", async () => {
    endpoint.command.mockResolvedValue(endpoint.success);
    const response = await call(endpoint);
    expect(response.status).toBe(200);
    expect(response.headers.get("carbon-api")).toBe("1");
    expect(await response.json()).toMatchObject({ ok: true });
    expect(endpoint.command).toHaveBeenCalledOnce();
  });

  it("attributes the work to the pinned operator, not the terminal", async () => {
    endpoint.command.mockResolvedValue(endpoint.success);
    await call(endpoint);
    // The scope argument is the one that decides whose name lands on the row.
    const scope = endpoint.command.mock.calls[0]?.find(
      (arg): arg is { userId: string; companyId: string } =>
        typeof arg === "object" &&
        arg !== null &&
        "userId" in arg &&
        "companyId" in arg
    );
    expect(scope).toMatchObject({ userId: OPERATOR, companyId: COMPANY });
    expect(scope?.userId).not.toBe(TERMINAL);
  });

  it("answers 405 to a GET", async () => {
    const response = await call(endpoint, { method: "GET" });
    expect(response.status).toBe(405);
  });

  it("requires an Idempotency-Key", async () => {
    endpoint.command.mockResolvedValue(endpoint.success);
    const mod = await endpoint.load();
    const response = await mod.action({
      request: new Request(`http://localhost${endpoint.path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(endpoint.needsLocation ? { "x-carbon-location": LOCATION } : {})
        },
        ...(endpoint.valid !== null
          ? { body: JSON.stringify(endpoint.valid) }
          : {})
      }),
      params: endpoint.params,
      context: {}
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("idempotency_key_required");
    expect(endpoint.command).not.toHaveBeenCalled();
  });

  it("maps a command failure to its status", async () => {
    endpoint.command.mockResolvedValue(
      failed({ kind: "error", message: "Nope" })
    );
    const response = await call(endpoint);
    expect(response.status).toBe(500);
    expect((await response.json()).error.message).toBe("Nope");
  });
});

describe("body validation", () => {
  it.each(
    ENDPOINTS.filter((e) => e.invalid !== null)
  )("$name refuses a body missing a required field", async (endpoint) => {
    endpoint.command.mockResolvedValue(endpoint.success);
    const response = await call(endpoint, { body: endpoint.invalid });
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.code).toBe("validation_failed");
    expect(payload.error.fields).toBeTruthy();
    expect(endpoint.command).not.toHaveBeenCalled();
  });
});

describe("print", () => {
  const print = ENDPOINTS.find((e) => e.name === "print")!;

  it("refuses a print with no location — it could not be routed", async () => {
    vi.mocked(printLabel).mockResolvedValue(ok(null));
    const mod = await print.load();
    const response = await mod.action({
      request: new Request(`http://localhost${print.path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "idempotency-key": "key-1"
        },
        body: JSON.stringify(print.valid)
      }),
      params: {},
      context: {}
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("location_required");
    expect(printLabel).not.toHaveBeenCalled();
  });

  it("passes the header location through to the print job", async () => {
    vi.mocked(printLabel).mockResolvedValue(ok(null));
    await call(print);
    expect(printLabel).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: LOCATION }),
      expect.anything()
    );
  });
});

describe("quality-issues", () => {
  it("gates on the quality create permission, as the web route does", async () => {
    vi.mocked(raiseQualityIssue).mockResolvedValue(ok({ id: "ncr-1" }));
    await call(ENDPOINTS.find((e) => e.name === "quality-issues")!);
    expect(requireApiUser).toHaveBeenCalledWith(
      expect.anything(),
      { create: "quality" },
      undefined
    );
  });
});
