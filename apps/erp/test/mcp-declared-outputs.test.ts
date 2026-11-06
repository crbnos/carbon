// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { outputJsonSchema } from "@carbon/api/catalog.server";
import type { ServiceFn } from "@carbon/api/service-fn.server";
import type { z } from "zod";
import { router } from "../app/modules/router.server";

const OPERATIONS = Object.entries(router).flatMap(([module, namespace]) =>
  Object.entries(namespace).flatMap(([name, value]) => {
    if (typeof value !== "function") return [];
    const fn = value as ServiceFn<z.ZodType, unknown>;
    return fn.output
      ? [{ name: `${module}_${name}`, responseSchema: outputJsonSchema(fn.output) }]
      : [];
  })
);

// Declared outputs are checked as modules adopt them. The generator still
// reflects the REAL return type with
// the type checker, so the two are compared here, operation by operation: a
// declared output that drifts from what `run` returns fails this test. The
// manifest is generated (`pnpm generate:mcp`), so this runs where it exists:
// CI's lint job, and locally after a generate.

const MANIFEST = resolve(
  __dirname,
  "../app/routes/api+/mcp+/lib/tool-metadata.json"
);

type Schema = Record<string, unknown>;

/**
 * One canonical form for both dialects. zod says `anyOf: [T, null]`, the
 * generator `type: [T, "null"]`; zod says `const`, the generator a one-member
 * `enum`; `Json` is a recursive union on one side and `z.unknown()` on the
 * other. Descriptions and strictness are not part of the shape.
 */
function canonical(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return {};
  const s = { ...(schema as Schema) };
  delete s.description;
  delete s.$schema;
  delete s.propertyNames;
  if (s.additionalProperties === false) delete s.additionalProperties;
  if (Object.keys(s).length === 0) return {};
  if ("const" in s) {
    s.enum = [s.const];
    delete s.const;
  }
  // nullable as a member
  if (Array.isArray(s.anyOf)) {
    const members = (s.anyOf as Schema[]).map(canonical);
    const nonNull = members.filter(
      (m) => !(m && typeof m === "object" && (m as Schema).type === "null")
    );
    const nullable = nonNull.length < members.length;
    if (nonNull.length === 0) return { type: "null" };
    if (nonNull.some((m) => Object.keys(m as object).length === 0)) return {};
    if (nonNull.length === 1) {
      return nullable
        ? { ...(nonNull[0] as Schema), nullable: true }
        : nonNull[0];
    }
    const sorted = nonNull
      .map((m) => stable(m))
      .sort()
      .map((m) => JSON.parse(m));
    return nullable ? { anyOf: sorted, nullable: true } : { anyOf: sorted };
  }
  let nullable = false;
  if (Array.isArray(s.type)) {
    const types = (s.type as string[]).filter((t) => t !== "null");
    nullable = types.length < (s.type as string[]).length;
    if (types.length === 1) s.type = types[0];
    else if (types.length === 0) return { type: "null" };
    else {
      return {
        anyOf: types.map((t) => ({ type: t })).sort(),
        ...(nullable ? { nullable: true } : {})
      };
    }
  }
  const out: Schema = { type: s.type };
  if (nullable) out.nullable = true;
  if (Array.isArray(s.enum)) {
    out.enum = [...(s.enum as unknown[])].sort();
  }
  if (s.type === "array") out.items = canonical(s.items);
  if (s.type === "object") {
    const properties = s.properties as Record<string, unknown> | undefined;
    if (properties && Object.keys(properties).length > 0) {
      const required = new Set((s.required as string[] | undefined) ?? []);
      out.properties = Object.fromEntries(
        Object.keys(properties)
          .sort()
          .map((k) => [
            k,
            { ...(canonical(properties[k]) as object), ...(required.has(k) ? {} : { optional: true }) }
          ])
      );
    } else {
      // a record, or an opaque object: the value shape is all there is
      const extra = s.additionalProperties;
      out.additional =
        extra && typeof extra === "object" ? canonical(extra) : {};
    }
  }
  return out;
}

/** JSON with keys in one order, so two equal schemas print the same. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as object)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]])
        )
      : v
  );
}

/** The first path where two canonical schemas differ, for the message. */
function firstDifference(a: unknown, b: unknown, path = "$"): string | null {
  if (stable(a) === stable(b)) return null;
  // either side `{}` is unknown and matches anything
  if (isUnknown(a) || isUnknown(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ra = a as Schema;
    const rb = b as Schema;
    if (ra.type !== rb.type) {
      return `${path}: type ${JSON.stringify(ra.type)} vs ${JSON.stringify(rb.type)}`;
    }
    // a union: every member of one side must match a member of the other,
    // member by member, so an unknown inside a member still matches anything
    if (Array.isArray(ra.anyOf) || Array.isArray(rb.anyOf)) {
      const ma = (ra.anyOf as unknown[] | undefined) ?? [a];
      const mb = (rb.anyOf as unknown[] | undefined) ?? [b];
      if (ma.length !== mb.length) {
        return `${path}: ${ma.length} vs ${mb.length} union members`;
      }
      const unmatched = ma.find(
        (x) => !mb.some((y) => firstDifference(x, y, path) === null)
      );
      if (!unmatched) return null;
      // Name the nearest reflected member (the same discriminator, when the
      // union has one) and where it differs, so the message says what to fix.
      const tag = (m: unknown) => {
        const props = (m as Schema).properties as
          | Record<string, unknown>
          | undefined;
        return stable(props?.type ?? null);
      };
      const nearest =
        mb.find((y) => tag(y) === tag(unmatched)) ?? mb[0];
      const where = nearest
        ? firstDifference(unmatched, nearest, `${path}{member}`)
        : null;
      return `${path}: no reflected member matches ${stable(unmatched)}; nearest ${stable(nearest)}${where ? ` (${where})` : ""}`;
    }
    if (ra.properties && rb.properties) {
      const pa = ra.properties as Record<string, unknown>;
      const pb = rb.properties as Record<string, unknown>;
      for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
        if (!(k in pa)) return `${path}.${k}: only reflected`;
        if (!(k in pb)) return `${path}.${k}: only declared`;
        const d = firstDifference(pa[k], pb[k], `${path}.${k}`);
        if (d) return d;
      }
      return null;
    }
    if (ra.items || rb.items) {
      return firstDifference(ra.items, rb.items, `${path}[]`);
    }
    if (ra.additional || rb.additional) {
      return firstDifference(ra.additional, rb.additional, `${path}{}`);
    }
  }
  return `${path}: ${stable(a)} vs ${stable(b)}`;
}

function isUnknown(x: unknown): boolean {
  return !!x && typeof x === "object" && Object.keys(x as object).length === 0;
}

describe.skipIf(!existsSync(MANIFEST))(
  "declared outputs match the reflected return types",
  () => {
    it("agrees on every declared operation the generator reflected", () => {
      // Read inside the test: a skipped suite is still collected, and the
      // ERP test run has no manifest unless something generated one.
      const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
        tools: { name: string; responseSchema?: Schema }[];
      };
      const reflected = new Map(
        manifest.tools.map((t) => [t.name, t.responseSchema])
      );
      expect(OPERATIONS.length, "At least one output must be checked").toBeGreaterThan(0);
      const problems: string[] = [];
      for (const op of OPERATIONS) {
        const expected = reflected.get(op.name);
        const declared = op.responseSchema;
        if (!expected && !declared) continue;
        if (!expected) {
          problems.push(`${op.name}: declares an output but run returns nothing`);
          continue;
        }
        if (!declared) {
          problems.push(`${op.name}: run returns a value but declares no output`);
          continue;
        }
        const difference = firstDifference(
          canonical(declared),
          canonical(expected)
        );
        if (difference) problems.push(`${op.name}: ${difference}`);
      }
      expect(
        problems,
        `${problems.length} operation(s) disagree:\n${problems.slice(0, 60).join("\n")}`
      ).toEqual([]);
    });
  }
);
