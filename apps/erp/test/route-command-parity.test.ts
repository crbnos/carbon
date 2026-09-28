import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import metadata from "../app/routes/api+/mcp+/lib/tool-metadata.json";

// One operation, one implementation. Each tool below publishes the command a
// UI route runs; this pins that the route and the tool reach the SAME
// function, so a later edit cannot quietly fork them again (the route growing
// a step the tool lacks is how every bug in this class started).
//
// For each case: the tool is in the manifest; when it is a companion tool, the
// companion export calls the command; and every route that performs the
// operation imports the command from the named module and calls it.

type Case = {
  tool: string;
  /** Companion file whose same-named export publishes the command. */
  companion?: string;
  /** How the companion export calls each command (import alias included). */
  companionCalls?: string[];
  commands: string[];
  /** Module specifier the routes import the commands from. */
  from: string;
  routes: string[];
};

const ITEM_TYPES = ["part", "material", "tool", "consumable", "service"];

const CASES: Case[] = [
  {
    tool: "sales_upsertQuoteLine",
    companion: "sales/sales.mcp.server.ts",
    commands: ["createQuoteLineWithPrices", "updateQuoteLineWithPrices"],
    from: "~/modules/sales/sales.server",
    routes: [
      "x+/quote+/$quoteId.new.tsx",
      "x+/quote+/$quoteId.$lineId.details.tsx"
    ]
  },
  {
    tool: "sales_upsertQuoteMaterial",
    companion: "sales/sales.mcp.server.ts",
    commands: ["saveQuoteMaterialWithPrices"],
    from: "~/modules/sales/sales.server",
    routes: [
      "x+/quote+/methods+/$quoteId.$lineId.material.new.tsx",
      "x+/quote+/methods+/$quoteId.$lineId.material.$id.tsx"
    ]
  },
  {
    tool: "sales_deleteQuoteMaterial",
    companion: "sales/sales.mcp.server.ts",
    commands: ["deleteQuoteMaterialWithPrices"],
    from: "~/modules/sales/sales.server",
    routes: ["x+/quote+/methods+/$quoteId.$lineId.material.delete.$id.tsx"]
  },
  {
    tool: "sales_upsertQuoteOperation",
    companion: "sales/sales.mcp.server.ts",
    commands: ["saveQuoteOperationWithPrices"],
    from: "~/modules/sales/sales.server",
    routes: [
      "x+/quote+/methods+/$quoteId.$lineId.operation.new.tsx",
      "x+/quote+/methods+/$quoteId.$lineId.operation.$id.tsx"
    ]
  },
  {
    tool: "sales_deleteQuoteOperation",
    companion: "sales/sales.mcp.server.ts",
    commands: ["deleteQuoteOperationWithPrices"],
    from: "~/modules/sales/sales.server",
    routes: ["x+/quote+/methods+/operation.delete.tsx"]
  },
  {
    tool: "sales_releaseSalesOrder",
    companion: "sales/sales.mcp.server.ts",
    commands: ["confirmSalesOrder"],
    from: "~/modules/sales/sales.server",
    routes: ["x+/sales-order+/$orderId.confirm.tsx"]
  },
  {
    // The service function IS the command: no companion needed.
    tool: "sales_finalizeQuote",
    commands: ["finalizeQuote"],
    from: "~/modules/sales",
    routes: ["x+/quote+/$quoteId.finalize.tsx"]
  },
  {
    tool: "sales_convertSalesRfqToQuote",
    commands: ["convertSalesRfqToQuote"],
    from: "~/modules/sales",
    routes: ["x+/sales-rfq+/$rfqId.convert.tsx"]
  },
  {
    tool: "items_setItemActive",
    companion: "items/items.mcp.server.ts",
    companionCalls: ["setItemActiveCommand"],
    commands: ["setItemActive"],
    from: "~/modules/items/items.server",
    routes: ["x+/items+/update.tsx"]
  },
  {
    tool: "items_upsertSupplierPartPrices",
    companion: "items/items.mcp.server.ts",
    companionCalls: ["upsertSupplierPartPricesRow"],
    commands: ["upsertSupplierPartPrices"],
    from: "~/modules/items",
    routes: ITEM_TYPES.flatMap((t) => [
      `x+/${t}+/$itemId.purchasing.new.tsx`,
      `x+/${t}+/$itemId.purchasing.$supplierPartId.tsx`
    ])
  }
];

const APP = join(__dirname, "../app");
const read = (rel: string) => readFileSync(join(APP, rel), "utf8");
const tools = new Set(
  (metadata.tools as { name: string }[]).map((tool) => tool.name)
);

/** The body of `export async function name(` up to the next top-level export. */
function exportedBody(source: string, name: string): string | null {
  const start = source.search(
    new RegExp(`export async function ${name}\\s*\\(`)
  );
  if (start < 0) return null;
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

function importsFrom(source: string, name: string, from: string): boolean {
  return [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)].some(
    (m) =>
      m[2] === from &&
      m[1]!
        .split(",")
        .map((s) => s.trim())
        .includes(name)
  );
}

describe("route command parity", () => {
  for (const c of CASES) {
    describe(c.tool, () => {
      it("is published", () => {
        expect(tools.has(c.tool)).toBe(true);
      });

      if (c.companion) {
        it("the companion export calls the command", () => {
          const fn = c.tool.slice(c.tool.indexOf("_") + 1);
          const body = exportedBody(read(`modules/${c.companion}`), fn);
          expect(body, `${c.companion} exports ${fn}`).not.toBeNull();
          for (const call of c.companionCalls ?? c.commands) {
            expect(body).toContain(`${call}(`);
          }
        });
      }

      for (const route of c.routes) {
        it(`${route} runs the same command`, () => {
          const source = read(`routes/${route}`);
          const used = c.commands.filter((cmd) =>
            source.includes(`${cmd}(`)
          );
          expect(used.length, `${route} calls a command`).toBeGreaterThan(0);
          for (const cmd of used) {
            expect(importsFrom(source, cmd, c.from)).toBe(true);
          }
        });
      }
    });
  }
});
