import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { PostgresError } from "pg";
import {
  corsPreflight,
  errorResponse,
  isDataLayerError,
  jsonResponse,
} from "./response.ts";

// This suite asserts on real `Response` objects — `Response` is a Deno built-in and
// needs no permissions. The contract under test: error bodies carry the reason under
// `message` (and nothing else), the key is omitted when there is no usable message, and
// data-layer errors are structurally classified and sanitized without text-matching.

Deno.test("corsPreflight returns null for non-OPTIONS methods", () => {
  assertEquals(corsPreflight(new Request("http://x", { method: "POST" })), null);
  assertEquals(corsPreflight(new Request("http://x", { method: "GET" })), null);
});

Deno.test("corsPreflight handles OPTIONS with CORS and no JSON content-type", async () => {
  const res = corsPreflight(new Request("http://x", { method: "OPTIONS" }));
  assert(res !== null);
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "ok");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert(res.headers.get("Content-Type") !== "application/json");
});

Deno.test("jsonResponse defaults to 200 with CORS + JSON content-type", async () => {
  const res = jsonResponse({ success: true });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/json");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(await res.json(), { success: true });
});

Deno.test("jsonResponse honors explicit status", () => {
  assertEquals(jsonResponse({ id: "x" }, 201).status, 201);
});

Deno.test("errorResponse defaults to 500 and surfaces Error.message", async () => {
  const res = errorResponse(new Error("boom"));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { message: "boom" });
});

Deno.test("errorResponse accepts a raw string literal", async () => {
  const res = errorResponse("Invalid operation type", 400);
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { message: "Invalid operation type" });
});

Deno.test("errorResponse duck-types { message }", async () => {
  assertEquals(await errorResponse({ message: "duck" }).json(), {
    message: "duck",
  });
});

Deno.test("errorResponse omits message when there is none", async () => {
  for (const input of [new Error(""), null, undefined, 42, {}]) {
    const body = await errorResponse(input).json();
    assertEquals(body, {});
    assert(!("message" in body));
  }
});

Deno.test("original-bug guard: Error serializes to {} but errorResponse recovers message", async () => {
  assertEquals(JSON.stringify(new Error("boom")), "{}");
  assertEquals(await errorResponse(new Error("boom")).json(), { message: "boom" });
});

Deno.test("errorResponse merges defined extras", async () => {
  const res = errorResponse(new Error("bad"), 400, { invalidLineIds: ["a", "b"] });
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { message: "bad", invalidLineIds: ["a", "b"] });
});

Deno.test("errorResponse drops undefined extras", async () => {
  const body = await errorResponse(new Error("bad"), 500, {
    invalidLineIds: undefined,
  }).json();
  assertEquals(body, { message: "bad" });
  assert(!("invalidLineIds" in body));
});

Deno.test("contract lock: error bodies contain no error or success key", async () => {
  const body = await errorResponse(new Error("boom")).json();
  assert(!("error" in body));
  assert(!("success" in body));
});

Deno.test("sanitizer suppresses PostgresError (imported class)", async () => {
  const err = new PostgresError({
    severity: "ERROR",
    code: "23505",
    message: 'duplicate key value violates unique constraint "receiptLine_pkey"',
    // deno-lint-ignore no-explicit-any
  } as any);
  assert(isDataLayerError(err));
  assertEquals(await errorResponse(err).json(), {});
});

Deno.test("sanitizer suppresses Postgrest-shaped error", async () => {
  const err = {
    code: "23505",
    details: "Key (id)=(x) already exists.",
    hint: null,
    message: 'duplicate key value violates unique constraint "receiptLine_pkey"',
  };
  assert(isDataLayerError(err));
  assertEquals(await errorResponse(err).json(), {});
});

Deno.test("sanitizer suppresses node-pg-shaped error", async () => {
  const err = { code: "23505", severity: "ERROR", message: "boom" };
  assert(isDataLayerError(err));
  assertEquals(await errorResponse(err).json(), {});
});

// A ZodError's raw `.message` is a JSON dump, so `isDataLayerError` still blocks
// it — but a payload-validation failure is the CALLER's input contract, not a
// data-layer leak. `zodIssueSummary` replaces it with a compact `path: message`
// summary so an API caller has something to converge on; suppressing it entirely
// left them with only the service's generic fallback string.
Deno.test("ZodError is replaced by a compact issue summary, never its raw dump", async () => {
  const err = Object.assign(new Error("[{...}]"), {
    name: "ZodError",
    issues: [{ path: [], message: "x" }],
  });
  assert(isDataLayerError(err));
  const body = await errorResponse(err).json();
  assertEquals(body, { message: "Invalid payload — x" });
  assert(!body.message.includes("[{...}]"));
});

Deno.test("ZodError summary names the offending field and caps at five issues", async () => {
  const err = Object.assign(new Error("[{...}]"), {
    name: "ZodError",
    issues: Array.from({ length: 7 }, (_, i) => ({
      path: ["body", `field${i}`],
      message: "Required",
    })),
  });
  const { message } = await errorResponse(err).json();
  assertEquals(
    message,
    "Invalid payload — body.field0: Required; body.field1: Required; " +
      "body.field2: Required; body.field3: Required; body.field4: Required; +2 more",
  );
});

Deno.test("a ZodError with no issues omits the message key entirely", async () => {
  const err = Object.assign(new Error("[{...}]"), {
    name: "ZodError",
    issues: [],
  });
  // `getEdgeFunctionErrorMessage` falls back to the caller's own copy when the
  // key is absent, so an empty summary must not ship an empty string.
  assertEquals(await errorResponse(err).json(), {});
});

Deno.test("sanitizer does not overreach: authored Error with DB-looking text is surfaced", async () => {
  const err = new Error(
    'duplicate key value violates unique constraint "x"'
  );
  assert(!isDataLayerError(err));
  assertEquals(await errorResponse(err).json(), {
    message: 'duplicate key value violates unique constraint "x"',
  });
});

Deno.test("isDataLayerError returns false for non-data-layer values", () => {
  for (const input of ["a string", null, undefined, 42, {}, new Error("x")]) {
    assertEquals(isDataLayerError(input), false);
  }
});
