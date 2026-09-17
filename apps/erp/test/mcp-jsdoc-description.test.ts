// Pins the generator's function-level JSDoc → tool description extraction.
// The unit cases exercise the summary normalizer directly; the integration
// case proves the wiring against the generated manifest without pinning any
// one function's prose (comments are free to change).
import { describe, expect, test } from "vitest";
import { extractJsdocSummary } from "../../../scripts/lib/service-metadata";
import toolMetadata from "../app/routes/api+/mcp+/lib/tool-metadata.json";

function nameDerived(name: string): string {
  const func = name.slice(name.indexOf("_") + 1);
  return func
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase();
}

describe("extractJsdocSummary", () => {
  test("takes the first sentence and strips the trailing period", () => {
    expect(
      extractJsdocSummary(
        "\n * Customers with contact and payment terms. Prefer the list variant for dropdowns.\n "
      )
    ).toBe("customers with contact and payment terms");
  });

  test("ignores tag sections", () => {
    expect(
      extractJsdocSummary("\n * Resolves the swap.\n * @param client supabase\n ")
    ).toBe("resolves the swap");
  });

  test("keeps a leading acronym's casing", () => {
    expect(extractJsdocSummary(" MRP demand for one item. ")).toBe(
      "MRP demand for one item"
    );
  });

  test("returns undefined for tag-only or empty blocks", () => {
    expect(extractJsdocSummary("\n * @deprecated use the other one\n ")).toBe(
      undefined
    );
    expect(extractJsdocSummary("  \n * \n ")).toBe(undefined);
  });

  test("caps runaway summaries", () => {
    const summary = extractJsdocSummary(`long ${"word ".repeat(80)}`);
    expect(summary!.length).toBeLessThanOrEqual(160);
    expect(summary!.endsWith("…")).toBe(true);
  });
});

describe("generated manifest", () => {
  test("marks paginating vs fetchAll list services", () => {
    const byName = new Map(toolMetadata.tools.map((t) => [t.name, t]));
    // getJobs pages via setGenericQueryFilters; getJobsList is a fetchAll read
    // whose limit/offset are inert — the MCP layer pages its response instead.
    expect(byName.get("production_getJobs")?.paginates).toBe(true);
    expect(byName.get("production_getJobsList")?.paginates).toBe(false);
  });

  test("carries JSDoc-derived descriptions, not only name-derived ones", () => {
    const informative = toolMetadata.tools.filter(
      (tool) => tool.description !== nameDerived(tool.name)
    );
    // ~130 service functions already carry a function-level JSDoc; if this
    // drops to a handful the extraction wiring broke.
    expect(informative.length).toBeGreaterThan(50);
  });
});
