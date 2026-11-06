// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The operation catalog for the Carbon API v1 surface, built from the
// service-function registry at startup (`buildOperationCatalog`): every
// `defineServiceFn` with `publish` set, its input schema from its own zod
// validator, its title and description from its definition. The oRPC router,
// the MCP bridge and the OpenAPI document are views of this one list; nothing
// here reads generated output.

import type { ManifestEntry } from "@carbon/api";
import {
  buildOperationCatalog,
  type Operation
} from "@carbon/api/catalog.server";
import { COMPANY_TABLES as companyTables } from "@carbon/database/company-tables";
import { router as services } from "~/modules/router.server";

export type { Operation };

/** Every published operation, in router order. */
export const OPERATIONS: Operation[] = buildOperationCatalog(services);

/**
 * Every table with a `companyId` column, from the generated database types.
 * The dispatcher confines every write to the caller's company by this list
 * (`scopedToCompany`).
 */
export const COMPANY_TABLES: ReadonlySet<string> = new Set(companyTables);

/** Every published operation by its name. */
export const operationsByName = new Map<string, Operation>(
  OPERATIONS.map((op) => [op.name, op])
);

/** The bare operation id (the name without its `module_` prefix). */
export function operationId(
  op: Pick<ManifestEntry, "name" | "module">
): string {
  return op.name.slice(op.module.length + 1);
}

/** The operation's HTTP path: `/{module}/{operationId}` (`/production/cancelJob`). */
export function operationPath(
  op: Pick<ManifestEntry, "name" | "module">
): `/${string}` {
  return `/${op.module}/${operationId(op)}`;
}

/**
 * What a dispatch produced: the data, the total of a paged list, and whether
 * the HTTP body is the list envelope. Decided from the result itself — a
 * `paged()` result is marked, any other array is a list — not from a
 * reflected return type, so it needs nothing generated.
 */
export type DispatchResult = { data: unknown; count?: number; list: boolean };

/**
 * Whether an operation is known to answer with a list before it runs: a
 * paged one. A non-paged list is found out from its result. Used by the MCP
 * to describe a tool and to page a response; with a declared `output`
 * (phase 2) every list is known here.
 */
export function isListOperation(
  op: Pick<ManifestEntry, "paginates" | "responseSchema">
): boolean {
  const type = (op.responseSchema as { type?: string | string[] } | undefined)
    ?.type;
  return (
    op.paginates ||
    type === "array" ||
    (Array.isArray(type) && type.includes("array"))
  );
}

/**
 * The success body over HTTP. Single results are the payload itself — wrapping
 * everything in `{ data }` stacked our envelope under every generated client's own
 * result wrapper, so callers wrote `res.data.data.field`. Lists keep the envelope
 * because `count` belongs there (the Stripe convention).
 */
export function outputSchema(
  op: Pick<ManifestEntry, "paginates" | "responseSchema">
): Record<string, unknown> {
  if (!isListOperation(op)) return op.responseSchema ?? {};
  return {
    type: "object",
    properties: {
      results: op.responseSchema ?? { type: "array" },
      count: {
        type: ["number", "null"],
        description: "Total matching rows, present on paginated reads."
      }
    },
    required: ["results"]
  };
}

/** Shape a dispatch result into the HTTP body `outputSchema` promises. */
export function shapeHttpBody(result: DispatchResult): unknown {
  // `results`, not `data`: generated clients wrap responses in their own `.data`,
  // so an envelope field named `data` reads back as `res.data.data`.
  return result.list
    ? { results: result.data, count: result.count ?? null }
    : result.data;
}
