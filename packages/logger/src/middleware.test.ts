import { AsyncLocalStorage } from "node:async_hooks";
import { configureSync, reset } from "@logtape/logtape";
import { createLogRecorder } from "@logtape/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLogger } from "./logger";
import {
  getRequestId,
  REQUEST_ID_HEADER,
  requestIdContext,
  requestIdMiddleware
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
    contextLocalStorage: new AsyncLocalStorage(),
    sinks: { recorder: recorder.sink },
    loggers: [
      { category: ["carbon"], lowestLevel: "trace", sinks: ["recorder"] }
    ]
  });
});

afterEach(async () => {
  await reset();
});

describe("requestIdMiddleware", () => {
  it("generates and echoes a request id", async () => {
    const request = new Request("http://x/dashboard");
    const context = makeContext();
    const next = async () => new Response("ok");

    const res = (await requestIdMiddleware(
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
    const res = (await requestIdMiddleware(
      { request, context } as never,
      async () => new Response("ok")
    )) as Response;
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("abc-123");
    expect(getRequestId(context)).toBe("abc-123");
  });

  it("propagates the request id into logs emitted inside the handler (ALS)", async () => {
    const request = new Request("http://x/dashboard", {
      headers: { [REQUEST_ID_HEADER]: "trace-me" }
    });
    const next = async () => {
      getLogger("erp", "sales").info("did a thing");
      return new Response("ok");
    };

    await requestIdMiddleware(
      { request, context: makeContext() } as never,
      next
    );

    const record = recorder.records.find(
      (r) => r.category.join(".") === "carbon.erp.sales"
    );
    expect(record).toBeDefined();
    expect(record?.properties.requestId).toBe("trace-me");
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

describe("requestIdMiddleware body logging", () => {
  it("captures a JSON body and redacts sensitive fields", async () => {
    const request = jsonRequest(
      JSON.stringify({
        name: "Widget",
        password: "hunter2",
        nested: { token: "t" }
      })
    );
    await requestIdMiddleware(
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
    await requestIdMiddleware(
      { request, context: makeContext() } as never,
      async () => {
        handlerSaw = await request.json();
        return new Response("ok");
      }
    );
    expect(handlerSaw).toEqual({ hello: "world" });
  });

  it("captures a form-urlencoded body and redacts sensitive fields", async () => {
    const body = "email=a%40b.com&note=hi";
    const request = new Request("http://x/action", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(body.length)
      }
    });
    await requestIdMiddleware(
      { request, context: makeContext() } as never,
      async () => new Response("ok")
    );
    const captured = httpRecord()?.properties.body as Record<string, unknown>;
    expect(captured.email).toBe("[REDACTED]");
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
    await requestIdMiddleware(
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
    await requestIdMiddleware(
      { request, context: makeContext() } as never,
      async () => new Response("ok")
    );
    expect(httpRecord()?.properties.body).toBe(
      `<${64 * 1024} bytes not captured>`
    );
  });

  it("adds no body for GET requests", async () => {
    const request = new Request("http://x/dashboard");
    await requestIdMiddleware(
      { request, context: makeContext() } as never,
      async () => new Response("ok")
    );
    expect(httpRecord()?.properties.body).toBeUndefined();
  });

  it("captures the query string and redacts sensitive params", async () => {
    const request = new Request("http://x/callback?ref=home&token=abc123");
    await requestIdMiddleware(
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
    await requestIdMiddleware(
      { request, context: makeContext() } as never,
      async () => new Response("ok")
    );
    expect(httpRecord()?.properties.search).toBe("");
  });
});
