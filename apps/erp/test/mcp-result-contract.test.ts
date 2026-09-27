import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import {
  buildResponseSchemaIndex,
  typeToJsonSchema,
  unwrapResponseType
} from "../../../scripts/lib/response-schema";
import {
  classifyResultType,
  isEnvelopeKeySet
} from "../../../scripts/lib/result-shape";
import { MODULE_LIST } from "../../../scripts/lib/service-metadata";
import metadata from "../app/routes/api+/mcp+/lib/tool-metadata.json";

// The service result contract (.claude/rules/conventions-services.md): a service
// returns `{ data, error }`, an array of those, nothing, or a plain value that
// cannot carry a failure. The generator classifies every export's declared
// return type and refuses to publish one that breaks the contract — these tests
// pin that classifier and the manifest it produces.

const PRELUDE = `
type PostgrestError = { code: string; message: string; details: string; hint: string };
type PostgrestSingleResponse<T> =
  | { data: T; error: null; count: number | null; status: number; statusText: string }
  | { data: null; error: PostgrestError; count: null; status: number; statusText: string };
interface Builder<T> extends PromiseLike<PostgrestSingleResponse<T>> {
  eq(column: string, value: string): Builder<T>;
}
declare function query<T>(): Builder<T>;
declare function run<T>(): Promise<PostgrestSingleResponse<T>>;
`;

function classify(body: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true, target: 99, lib: ["lib.es2022.d.ts"] }
  });
  const source = project.createSourceFile("service.ts", `${PRELUDE}\n${body}`);
  const fn = source.getFunctions().find((f) => f.isExported());
  if (!fn) throw new Error("no exported function");
  return {
    ...classifyResultType(fn.getReturnType(), fn),
    schema: typeToJsonSchema(unwrapResponseType(fn.getReturnType(), fn), fn)
  };
}

describe("classifyResultType", () => {
  it("classifies a returned query builder (un-awaited thenable) as an envelope", () => {
    const r = classify(
      `export function getThing() { return query<{ id: string }>().eq("id", "x"); }`
    );
    expect(r).toMatchObject({ shape: "envelope", violations: [] });
    expect(r.schema).toMatchObject({ type: "object", properties: { id: {} } });
  });

  it("classifies a hand-rolled { data, error } union as an envelope", () => {
    const r = classify(`
      export async function getThing(ok: boolean) {
        if (!ok) return { data: null, error: { message: "nope", code: "X" } };
        return { data: { id: "a" }, error: null };
      }`);
    expect(r).toMatchObject({ shape: "envelope", violations: [] });
  });

  it("documents a { data, count } read as the list inside it", () => {
    const r = classify(`
      export async function listThings() {
        return { data: [{ id: "a" }], count: 1 };
      }`);
    expect(r.shape).toBe("envelope");
    expect(r.schema).toMatchObject({ type: "array" });
  });

  it("classifies Promise.all over writes as an envelope array", () => {
    const r = classify(`
      export async function reorder(ids: string[]) {
        return Promise.all(ids.map(() => run<null>()));
      }`);
    expect(r).toMatchObject({ shape: "envelope-array", violations: [] });
  });

  it("classifies void and plain values", () => {
    expect(classify(`export async function f() { await run<null>(); }`).shape).toBe(
      "void"
    );
    expect(
      classify(`export async function f() { return { assigned: 1, skipped: 0 }; }`)
    ).toMatchObject({ shape: "plain", violations: [] });
  });

  it("refuses an error-only return", () => {
    const r = classify(`
      export async function f(x: boolean) {
        if (x) return { error: "This instruction has no model" };
        return { error: null };
      }`);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatch(/`error`/);
  });

  it("refuses a bespoke success/ok report", () => {
    expect(
      classify(`
        export async function f(): Promise<{ success: boolean; message: string }> {
          return { success: false, message: "Failed" };
        }`).violations[0]
    ).toMatch(/`success`/);
    expect(
      classify(`
        export async function f(): Promise<{ ok: true; created: number } | { ok: false; reason: string }> {
          return { ok: false, reason: "no-plan" };
        }`).violations[0]
    ).toMatch(/`ok`/);
  });

  it("refuses a union mixing an envelope with a plain value", () => {
    const r = classify(`
      export async function f(x: boolean) {
        if (x) return { error: "nope" };
        return run<null>();
      }`);
    expect(r.violations[0]).toMatch(/mixes envelope and plain/);
  });

  it("refuses a bigint anywhere in the result", () => {
    const r = classify(`
      export async function f(): Promise<{ numDeletedRows: bigint }[]> {
        return [];
      }`);
    expect(r.violations[0]).toMatch(/bigint/);
  });

  it("reports envelope extras the dispatcher drops, without refusing them", () => {
    const r = classify(`
      export async function f() {
        return { data: [1], error: null, hasMore: false };
      }`);
    expect(r).toMatchObject({
      shape: "envelope",
      violations: [],
      extras: ["hasMore"]
    });
  });

  it("reflects a Map as its entries array, marked as keyed", () => {
    const r = classify(`
      export async function f() {
        return { data: new Map<string, { leadTime: number }>(), error: null };
      }`);
    expect(r.schema).toMatchObject({
      type: "array",
      "x-carbon-map-entries": true,
      items: { type: "array", minItems: 2, maxItems: 2 }
    });
  });
});

describe("isEnvelopeKeySet — the one predicate reflector and dispatcher share", () => {
  it.each([
    [["data", "error"], true],
    [["data", "count"], true],
    [["data", "error", "count", "status", "statusText"], true],
    [["data", "error", "response"], true],
    [["data", "error", "cta"], true],
    [["data", "total"], false],
    [["error"], false],
    [["rows", "error"], false]
  ])("%j → %s", (keys, expected) => {
    expect(isEnvelopeKeySet(keys)).toBe(expected);
  });
});

type Tool = {
  name: string;
  resultShape?: string;
  droppedResultKeys?: string[];
};
const tools = (metadata as unknown as { tools: Tool[] }).tools;

describe("the generated manifest", () => {
  it("records a result shape for every operation", () => {
    expect(tools.filter((t) => !t.resultShape).map((t) => t.name)).toEqual([]);
  });

  // Envelope siblings (cta, hasMore, page) never reach a caller. Where they
  // belong — under `data`, or in a response `meta` — is an open decision; until
  // it is taken this list may only shrink.
  it("drops envelope extras only for the known, undecided operations", () => {
    const dropping = Object.fromEntries(
      tools
        .filter((t) => t.droppedResultKeys?.length)
        .map((t) => [t.name, t.droppedResultKeys])
    );
    expect(dropping).toEqual({
      accounting_getConsolidatedBalances: ["cta"],
      accounting_getConsolidatedPeriodSeries: ["ctaByBucket"],
      accounting_getFinancialStatementPeriodSeries: ["ctaByBucket"],
      accounting_translateCompanyBalances: ["cta"],
      inventory_getItemLedgerActivity: ["hasMore"],
      inventory_getItemLedgerPage: ["hasMore", "page", "pageSize"],
      production_getProductionEventsPage: ["hasMore", "page", "pageSize"]
    });
  });
});

describe("every exported service honors the result contract", () => {
  it(
    "has no result-contract violations",
    () => {
      const index = buildResponseSchemaIndex(MODULE_LIST);
      const violations: string[] = [];
      for (const tool of tools) {
        const [module, ...rest] = tool.name.split("_");
        const result = index.result(module, rest.join("_"));
        for (const violation of result?.violations ?? []) {
          violations.push(`${tool.name}: ${violation}`);
        }
      }
      expect(violations).toEqual([]);
    },
    180_000
  );
});
