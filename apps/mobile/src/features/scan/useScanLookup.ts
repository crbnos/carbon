// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import z from "zod";
import { useAuth } from "~/lib/auth/AuthProvider";
import { useSupabase } from "~/lib/auth/useSupabase";

/**
 * What is this code? A serial or lot, a part, or nothing we know.
 *
 * These two lookups go DIRECT over PostgREST as the signed-in user, not
 * through `/api/v1`. That is the split `.claude/rules/mes-mobile-api.md` draws:
 * every WRITE goes through the API because the server's command code carries
 * backflush, cost posting, genealogy and the floor gates — but `trackedEntity`
 * and `item` only require an employee of the company, so RLS alone is the right
 * gate and an endpoint would add nothing but a hop. Every read is still scoped
 * by `companyId` explicitly: RLS is the floor, not the only check.
 *
 * Deliberately NOT a TanStack query. A scan is an event, not a cached read: the
 * same lot's status changes on the floor between two scans of it, and
 * `lib/query/keys.ts` is the only place query keys are built, which a per-code
 * key would have to grow. A request-id ref gives exactly what this needs —
 * the latest scan wins, and a slow answer to a code the operator has already
 * moved past is dropped.
 */

const trackedEntityRow = z.object({
  id: z.string(),
  readableId: z.string().nullable(),
  status: z.string(),
  quantity: z.number(),
  itemId: z.string().nullable()
});

const itemRow = z.object({
  id: z.string(),
  readableId: z.string(),
  name: z.string(),
  type: z.string()
});

const TRACKED_ENTITY_SELECT = "id, readableId, status, quantity, itemId";
const ITEM_SELECT = "id, readableId, name, type";

export type ScanLookupResult =
  | {
      kind: "tracked-entity";
      id: string;
      /** Falls back to the raw id — an entity may have no readable id. */
      label: string;
      status: string;
      quantity: number;
      item: { readableId: string; name: string } | null;
    }
  | { kind: "item"; id: string; readableId: string; name: string; type: string }
  | { kind: "unknown"; value: string };

export type ScanLookupState =
  | { status: "idle" }
  | { status: "pending"; code: string }
  | { status: "done"; result: ScanLookupResult }
  /** The lookup itself failed — which is NOT the same as "nothing matches". */
  | { status: "error"; message: string };

/**
 * One row, or null.
 *
 * `.eq` and not `.ilike`: a printed code is scanned back exactly, and `_` is a
 * single-character wildcard in `LIKE` — so an `ilike` on `LOT_2026_04` would
 * quietly match other lots. `.or(...)` is avoided for the same class of
 * reason: its filter is one string, and a code containing a comma or a
 * parenthesis would change what was asked for. Two point lookups cost less
 * than that.
 */
async function firstMatch(
  client: SupabaseClient,
  table: string,
  select: string,
  companyId: string,
  column: string,
  value: string
): Promise<unknown> {
  const { data, error } = await client
    .from(table)
    .select(select)
    .eq("companyId", companyId)
    .eq(column, value)
    .limit(1)
    .maybeSingle();

  // Thrown, not swallowed: an unreachable server reported as "nothing matches"
  // sends an operator looking for a label that was perfectly fine.
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function lookupCode(
  client: SupabaseClient,
  companyId: string,
  value: string
): Promise<ScanLookupResult> {
  // A tracked entity first: a scan on the floor is far more often a serial or
  // lot label than a part number. By `readableId` as printed, then by `id` —
  // web MES matches a scanned entity on either
  // (`apps/mes/app/components/Inspection/ScanInspectionSample.tsx`).
  for (const column of ["readableId", "id"]) {
    const row = await firstMatch(
      client,
      "trackedEntity",
      TRACKED_ENTITY_SELECT,
      companyId,
      column,
      value
    );
    if (!row) continue;

    const entity = trackedEntityRow.parse(row);
    // The item is a second read rather than an `item(...)` embed:
    // `trackedEntity_itemId_fkey` resolves to several relations (the `item`
    // table and the views over it), which makes that embed ambiguous.
    let item: { readableId: string; name: string } | null = null;
    if (entity.itemId) {
      const itemData = await firstMatch(
        client,
        "item",
        ITEM_SELECT,
        companyId,
        "id",
        entity.itemId
      );
      if (itemData) {
        const parsed = itemRow.parse(itemData);
        item = { readableId: parsed.readableId, name: parsed.name };
      }
    }

    return {
      kind: "tracked-entity",
      id: entity.id,
      label: entity.readableId ?? entity.id,
      status: entity.status,
      quantity: entity.quantity,
      item
    };
  }

  // Then a part. `readableIdWithRevision` as well as `readableId` because a
  // revisioned part is labelled with the combined form in the ERP.
  for (const column of ["readableId", "readableIdWithRevision"]) {
    const row = await firstMatch(
      client,
      "item",
      ITEM_SELECT,
      companyId,
      column,
      value
    );
    if (!row) continue;
    const item = itemRow.parse(row);
    return {
      kind: "item",
      id: item.id,
      readableId: item.readableId,
      name: item.name,
      type: item.type
    };
  }

  return { kind: "unknown", value };
}

export function useScanLookup() {
  const { t } = useLingui();
  const { companyId } = useAuth();
  const supabase = useSupabase();

  const [state, setState] = useState<ScanLookupState>({ status: "idle" });

  // Only the most recent scan may write to the state.
  const requestId = useRef(0);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const lookup = useCallback(
    (code: string) => {
      const value = code.trim();
      const id = ++requestId.current;
      const settle = (next: ScanLookupState) => {
        if (mounted.current && requestId.current === id) setState(next);
      };

      if (!value) {
        settle({ status: "idle" });
        return;
      }

      setState({ status: "pending", code: value });

      void (async () => {
        try {
          if (!supabase || !companyId) {
            settle({
              status: "error",
              message: t`Sign in to look up a scanned code.`
            });
            return;
          }
          // The client is already reading as the signed-in user: AuthProvider
          // hands supabase-js the session as soon as /me answers, which is the
          // one place that happens. An anonymous client would return zero rows
          // rather than an error — "nothing matches" for a perfectly good
          // label — so this read deliberately does not try to repair it here.
          settle({
            status: "done",
            result: await lookupCode(supabase, companyId, value)
          });
        } catch (error) {
          settle({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : t`Could not look up that code.`
          });
        }
      })();
    },
    [companyId, supabase, t]
  );

  const reset = useCallback(() => {
    requestId.current += 1;
    setState({ status: "idle" });
  }, []);

  return { state, lookup, reset };
}
