// Guards for the declared context contract: what the dispatcher fills into a
// service call from the authenticated context is exactly what the service
// signature declares, and what it declares is true to the table it writes.
//
// Before this contract, three name rules decided it (the function-name verb, a
// hand-kept override table and a parameter-name list), which stamped createdBy
// into tables without the column, rewrote the author on updates, never stamped
// a createdBy that `clockIn` requires, and handed a positional `updatedBy` the
// whole request body. See scripts/lib/service-signatures.ts.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthField, ManifestEntry } from "@carbon/api";
import { beforeAll, describe, expect, it } from "vitest";
import {
  checkContextWrites,
  type GuardReport
} from "../../../scripts/lib/context-guards";
import { MODULE_LIST } from "../../../scripts/lib/service-metadata";
import {
  buildSignatureIndex,
  type SignatureIndex
} from "../../../scripts/lib/service-signatures";
import toolMetadataJson from "../app/routes/api+/mcp+/lib/tool-metadata.json";

const tools = (toolMetadataJson as unknown as { tools: ManifestEntry[] }).tools;

/**
 * Writes the column guard knowingly lets through, each waiting on a product
 * decision. Every entry is a create branch that declares a createdBy its table
 * has no column for; the edit branch — the only one the app's UI uses — is
 * correct and works. An entry that stops failing must be removed.
 */
const PENDING_DECISION = new Set([
  // Shipment / payment / delivery rows are created with their parent document
  // and only ever edited in the UI (always with an id). Decision: make these
  // services update-only, or keep a create branch without createdBy?
  "invoicing_upsertPurchaseInvoiceDelivery:purchaseInvoiceDelivery.createdBy",
  "purchasing_upsertPurchaseOrderDelivery:purchaseOrderDelivery.createdBy",
  "purchasing_upsertPurchaseOrderPayment:purchaseOrderPayment.createdBy",
  "sales_upsertQuotePayment:quotePayment.createdBy",
  "sales_upsertQuoteShipment:quoteShipment.createdBy",
  "sales_upsertSalesOrderPayment:salesOrderPayment.createdBy",
  "sales_upsertSalesOrderShipment:salesOrderShipment.createdBy",
  // No UI caller. Decision: block the tool, or fix the signature and keep an
  // API-only subsidiary create?
  "settings_insertSubsidiary:company.createdBy"
]);

const IDENTITY: readonly AuthField[] = [
  "companyId",
  "companyGroupId",
  "createdBy",
  "updatedBy"
];

let signatures: SignatureIndex;
let report: GuardReport;

beforeAll(() => {
  signatures = buildSignatureIndex(MODULE_LIST);
  report = checkContextWrites(tools, signatures);
}, 180_000);

function fnName(tool: ManifestEntry): string {
  return tool.name.slice(tool.module.length + 1);
}

describe("the declared context contract", () => {
  it("injectAuth equals the identity fields the service signature declares", () => {
    const drift: string[] = [];
    for (const tool of tools) {
      const signature = signatures.get(tool.module, fnName(tool));
      if (!signature) {
        drift.push(`${tool.name}: no signature`);
        continue;
      }
      const declared = new Set<string>();
      for (const param of signature.params) {
        if (param.slot !== "payload") continue;
        if (param.payload.scalar || param.payload.opaque) continue;
        for (const member of param.payload.members) {
          for (const field of member.fields) declared.add(field);
        }
      }
      const injected = tool.injectAuth.filter((f) => f !== "userId");
      const expected = [...declared].sort();
      if (JSON.stringify([...injected].sort()) !== JSON.stringify(expected)) {
        drift.push(
          `${tool.name}: injectAuth [${injected}] but the signature declares [${expected}]`
        );
      }
    }
    expect(drift).toEqual([]);
  });

  it("maps every positional context param to a context slot, and every other param to the payload", () => {
    const wrong: string[] = [];
    for (const tool of tools) {
      tool.serviceParams.forEach((name, i) => {
        const slot = tool.contextSlots.params[i];
        const expected =
          name === "createdBy" || name === "updatedBy"
            ? "auditUser"
            : [
                  "client",
                  "db",
                  "userId",
                  "companyId",
                  "companyGroupId",
                  "eliminationClient"
                ].includes(name)
              ? name
              : "payload";
        if (slot !== expected) wrong.push(`${tool.name}.${name}: ${slot}`);
      });
      if (tool.contextSlots.params.length !== tool.serviceParams.length) {
        wrong.push(`${tool.name}: ${tool.contextSlots.params.length} slots`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("publishes no field the dispatcher fills", () => {
    const leaked: string[] = [];
    for (const tool of tools) {
      const properties = Object.keys(
        (tool.schema as { properties?: Record<string, unknown> }).properties ??
          {}
      );
      const payloads = tool.serviceParams.filter(
        (_, i) => tool.contextSlots.params[i] === "payload"
      );
      // A sole payload is flattened into the root of the schema.
      if (payloads.length !== 1) continue;
      for (const field of tool.injectAuth) {
        if (properties.includes(field)) leaked.push(`${tool.name}.${field}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it("asks for _operation exactly when the service splits on an identity field", () => {
    const wrong: string[] = [];
    for (const tool of tools) {
      const asks = Boolean(
        (tool.schema as { properties?: Record<string, unknown> }).properties
          ?._operation
      );
      const splits = Object.values(tool.contextSlots.payloads).some(
        (payload) => payload.byOperation
      );
      if (asks !== splits) wrong.push(tool.name);
    }
    expect(wrong).toEqual([]);
  });

  it("never discriminates on an identity field outside byOperation", () => {
    const wrong = tools.flatMap((tool) =>
      Object.entries(tool.contextSlots.payloads)
        .filter(([, payload]) =>
          IDENTITY.includes(payload.discriminator?.key as AuthField)
        )
        .map(([name]) => `${tool.name}.${name}`)
    );
    expect(wrong).toEqual([]);
  });
});

describe("the declared identity fields are true to the written table", () => {
  it("every declared identity field that reaches a write is a column of the written table", () => {
    const found = report.findings
      .filter((f) => f.kind === "absent-column")
      .map((f) => `${f.tool}:${f.table}.${f.field}`);
    expect(found.filter((f) => !PENDING_DECISION.has(f))).toEqual([]);
    // A decision that has been taken (or a fixed signature) must leave the list.
    expect([...PENDING_DECISION].filter((f) => !found.includes(f))).toEqual(
      []
    );
  });

  it("a NOT NULL audit column without a default is declared by the payload or set by the service", () => {
    const found = report.findings
      .filter((f) => f.kind === "undeclared-required")
      .map((f) => `${f.tool}:${f.op} ${f.table}.${f.field}`);
    expect(found).toEqual([]);
  });

  it("follows a meaningful share of the declaring payloads' writes", () => {
    // The shapes the guard cannot follow are reported, not silently passed.
    if (report.skipped.length > 0) {
      console.info(
        `context-guards: ${report.checked} writes checked, ${report.skipped.length} not followed:\n  ${report.skipped.join("\n  ")}`
      );
    }
    expect(report.checked).toBeGreaterThan(300);
  });
});

const MODULES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../app/modules"
);

const sourceCache = new Map<string, string>();
function serviceSources(module: string): string {
  const cached = sourceCache.get(module);
  if (cached !== undefined) return cached;
  const dir = join(MODULES_DIR, module);
  let joined = "";
  try {
    joined = readdirSync(dir)
      .filter((f) => f.endsWith(".service.ts") || f.endsWith(".mcp.server.ts"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
  } catch {
    joined = "";
  }
  sourceCache.set(module, joined);
  return joined;
}

function signatureOf(source: string, fn: string): string | null {
  const match = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${fn}\\s*\\(`
  ).exec(source);
  if (!match) return null;
  const start = match.index + match[0].length;
  let depth = 1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if ("([{<".includes(ch)) depth++;
    else if (")]}>".includes(ch)) {
      depth--;
      if (depth === 0) return source.slice(start, i);
    }
  }
  return null;
}

function splitParams(signature: string): string[] {
  const params: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of signature) {
    if ("([{<".includes(ch)) depth++;
    else if (")]}>".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      params.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) params.push(current);
  return params;
}

const PAYLOAD_USER_ID = /(^|[{;,\s])userId\s*\??\s*:/;

/** A non-array payload param whose source type declares a `userId`. */
function payloadDeclaresUserId(signature: string): boolean {
  return splitParams(signature).some((param) => {
    const colon = param.indexOf(":");
    if (colon < 0) return false;
    const name = param.slice(0, colon).trim().replace(/\?$/, "");
    if (name === "userId") return false;
    const type = param.slice(colon + 1).trim();
    return !/\[\]\s*$/.test(type) && PAYLOAD_USER_ID.test(type);
  });
}

describe("payload userId injection", () => {
  it("marks every tool whose service payload declares a userId", () => {
    const missing = tools
      .filter((tool) => {
        const signature = signatureOf(
          serviceSources(tool.module),
          fnName(tool)
        );
        return (
          signature !== null &&
          payloadDeclaresUserId(signature) &&
          !tool.injectAuth.includes("userId")
        );
      })
      .map((tool) => tool.name);

    expect(missing).toEqual([]);
  });

  it("does not inject into services that take userId positionally", () => {
    const positional = tools.filter(
      (tool) =>
        tool.serviceParams.includes("userId") &&
        tool.injectAuth.includes("userId")
    );
    expect(positional.map((tool) => tool.name)).toEqual([]);
  });

  it("covers the edge-function wrappers that surfaced this", () => {
    for (const name of [
      "production_createJobOperationBatch",
      "production_updateJobOperationBatch",
      "production_releaseJobOperationBatch",
      "production_unreleaseJobOperationBatch"
    ]) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.injectAuth).toContain("userId");
    }
  });
});
