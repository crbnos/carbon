// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { configureSync, reset } from "@logtape/logtape";
import { createLogRecorder } from "@logtape/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addLogContext,
  describeRequest,
  withRequestLogContext
} from "./context.server";
import { getLogger } from "./logger";
import {
  getRequestId,
  handleServerError,
  REQUEST_ID_HEADER,
  requestIdContext,
  requestMiddleware
} from "./middleware.server";

const recorder = createLogRecorder();

// Minimal RouterContextProvider stub — a Map keyed by the context token.
function makeContext() {
  const store = new Map<unknown, unknown>();
  return {
    get: (c: unknown) => store.get(c),
    set: (c: unknown, v: unknown) => store.set(c, v)
    // biome-ignore lint/suspicious/noExplicitAny: test stub
  } as any;
}

beforeEach(() => {
  recorder.clear();
  configureSync({
    reset: true,
    sinks: { recorder: withRequestLogContext(recorder.sink) },
    loggers: [
      { category: ["carbon"], lowestLevel: "trace", sinks: ["recorder"] }
    ]
  });
});

afterEach(async () => {
  await reset();
});

describe("requestMiddleware", () => {
  it("generates and echoes a request id", async () => {
    const request = new Request("http://x/dashboard");
    const context = makeContext();
    const next = async () => new Response("ok");

    const res = (await requestMiddleware(
      { request, context } as never,
      next
    )) as Response;

    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id).toBeTruthy();
    expect(context.get(requestIdContext)).toBe(id);
  });

  it("reuses an inbound x-request-id", async () => {
    const request = new Request("http://x/dashboard", {
      headers: { [REQUEST_ID_HEADER]: "abc-123" }
    });
    const context = makeContext();
    const res = (await requestMiddleware(
      { request, context } as never,
      async () => new Response("ok")
    )) as Response;
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("abc-123");
    expect(getRequestId(context)).toBe("abc-123");
  });

  it("puts the request id and identity on logs written inside the request, a log's own value winning", async () => {
    const request = new Request("http://x/dashboard", {
      headers: { [REQUEST_ID_HEADER]: "trace-me" }
    });
    const next = async () => {
      addLogContext({ companyId: "c1", userId: "u1" });
      getLogger("erp", "sales").info("did a thing");
      getLogger("erp", "sales").info("for another company", {
        companyId: "c2"
      });
      return new Response("ok");
    };

    await requestMiddleware({ request, context: makeContext() } as never, next);

    const [record, other] = recorder.records.filter(
      (r) => r.category.join(".") === "carbon.erp.sales"
    );
    expect(record?.properties).toEqual({
      requestId: "trace-me",
      companyId: "c1",
      userId: "u1"
    });
    expect(other?.properties.companyId).toBe("c2");
  });
});

function httpRecord() {
  return recorder.records.find((r) => r.category.join(".") === "carbon.http");
}

function jsonRequest(body: string) {
  return new Request("http://x/action", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(body).length)
    }
  });
}

describe("requestMiddleware body logging", () => {
  it("captures a JSON body and redacts sensitive fields", async () => {
    const request = jsonRequest(
      JSON.stringify({
        name: "Widget",
        password: "hunter2",
        nested: { token: "t" }
      })
    );
    await requestMiddleware(
      { request, context: makeContext() } as never,
      async () => new Response("ok")
    );

    const body = httpRecord()?.properties.body as Record<string, unknown>;
    expect(body).toBeDefined();
    expect(body.name).toBe("Widget");
    expect(body.password).toBe("[REDACTED]");
    expect((body.nested as Record<string, unknown>).token).toBe("[REDACTED]");
  });

  it("leaves the body stream intact for the handler", async () => {
    const request = jsonRequest(JSON.stringify({ hello: "world" }));
    let handlerSaw: unknown;
    await requestMiddleware(
      { request, context: makeContext() } as never,
      async () => {
        handlerSaw = await request.json();
        return new Response("ok");
      }
    );
    expect(handlerSaw).toEqual({ hello: "world" });
  });

  it("captures a form-urlencoded body and redacts sensitive fields", async () => {
    // email/phone/address are ordinary ERP business data and stay visible —
    // hiding them made real request payloads unreconstructable from logs.
    const body = "email=a%40b.com&apiToken=t0p&note=hi";
    const request = new Request("http://x/action", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(body.length)
      }
    });
    await requestMiddleware(
      { request, context: makeContext() } as never,
      async () => new Response("ok")
    );
    const captured = httpRecord()?.properties.body as Record<string, unknown>;
    expect(captured.email).toBe("a@b.com");
    expect(captured.apiToken).toBe("[REDACTED]");
    expect(captured.note).toBe("hi");
  });

  it("skips multipart bodies", async () => {
    const request = new Request("http://x/upload", {
      method: "POST",
      body: "----x",
      headers: {
        "content-type": "multipart/form-data; boundary=x",
        "content-length": "5"
      }
    });
    await requestMiddleware(
      { request, context: makeContext() } as never,
      async () => new Response("ok")
    );
    expect(httpRecord()?.properties.body).toBe(
      "<multipart form-data not captured>"
    );
  });

  it("skips oversized bodies by content-length", async () => {
    const request = new Request("http://x/action", {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        "content-length": String(64 * 1024)
      }
    });
    await requestMiddleware(
      { request, context: makeContext() } as never,
      async () => new Response("ok")
    );
    expect(httpRecord()?.properties.body).toBe(
      `<${64 * 1024} bytes not captured>`
    );
  });

  it("adds no body for GET requests", async () => {
    const request = new Request("http://x/dashboard");
    await requestMiddleware(
      { request, context: makeContext() } as never,
      async () => new Response("ok")
    );
    expect(httpRecord()?.properties.body).toBeUndefined();
  });

  it("captures the query string and redacts sensitive params", async () => {
    const request = new Request("http://x/callback?ref=home&token=abc123");
    await requestMiddleware(
      { request, context: makeContext() } as never,
      async () => new Response("ok")
    );
    const search = httpRecord()?.properties.search as string;
    expect(search).toContain("ref=home");
    expect(search).toContain("token=%5BREDACTED%5D");
    expect(search).not.toContain("abc123");
  });

  it("logs an empty search for a query-less request", async () => {
    const request = new Request("http://x/dashboard");
    await requestMiddleware(
      { request, context: makeContext() } as never,
      async () => new Response("ok")
    );
    expect(httpRecord()?.properties.search).toBe("");
  });
});

describe("describeRequest", () => {
  it("puts what a shared route served into the access log line", async () => {
    const request = new Request(
      "http://x/api/inngest?fnId=carbon-event-queue",
      {
        method: "POST"
      }
    );
    const context = makeContext();
    const args = { request, context } as never;

    await requestMiddleware(args, async () => {
      describeRequest("carbon-event-queue");
      return new Response("ok");
    });

    const access = recorder.records.find(
      (record) => record.properties.pathname === "/api/inngest"
    );
    expect(access?.properties.detail).toBe("carbon-event-queue");
    expect(access?.message.join("")).toContain(
      "POST /api/inngest carbon-event-queue"
    );
  });

  it("leaves the line alone for a request that says nothing", async () => {
    const context = makeContext();
    const args = {
      request: new Request("http://x/dashboard"),
      context
    } as never;

    // One middleware: the id is readable with no context in hand, and echoed.
    let ambientId: string | null = null;
    const response = (await requestMiddleware(args, async () => {
      ambientId = getRequestId();
      return new Response("ok");
    })) as Response;
    expect(ambientId).not.toBeNull();
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(ambientId);

    const access = recorder.records.find(
      (record) => record.properties.pathname === "/dashboard"
    );
    expect(access?.properties).not.toHaveProperty("detail");
  });
});

describe("handleServerError", () => {
  const aborted = (method: string) => {
    const controller = new AbortController();
    controller.abort();
    return new Request("http://x/sales", { method, signal: controller.signal });
  };
  const logged = () => recorder.records.map((r) => r.properties.pathname);

  it("logs a failed write even after the client left", () => {
    handleServerError(new Error("boom"), { request: aborted("POST") });
    expect(logged()).toEqual(["/sales"]);
  });

  it("skips a read the client abandoned and a thrown response", () => {
    handleServerError(new Error("boom"), { request: aborted("GET") });
    handleServerError(new Response(null, { status: 503 }), {
      request: new Request("http://x/sales")
    });
    expect(logged()).toEqual([]);
  });
});
