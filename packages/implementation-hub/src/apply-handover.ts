// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs "Apply to hub" for the sales handover: reads the hub, plans the writes
// (logic/handover.ts decides what is copied and what is skipped), makes them,
// and records their keys so a later apply never makes them again. Called by
// applyHubMutation, which has already refused anyone but Carbon staff.

import type { Database } from "@carbon/database";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appliedHandoverValue,
  HANDOVER_APPLIED_KEY,
  type HandoverWrite,
  handoverAnswers,
  planHandover
} from "./logic/handover";
import { fieldMap } from "./logic/overlay";
import {
  getImplementationFieldValues,
  getImplementationHub,
  getImplementationRows,
  updateImplementationHub
} from "./server";
import type { HubContacts, Tier } from "./types";

type Client = SupabaseClient<Database>;

type Of<K extends HandoverWrite["kind"]> = Extract<HandoverWrite, { kind: K }>;
const ofKind = <K extends HandoverWrite["kind"]>(
  writes: HandoverWrite[],
  kind: K
) => writes.filter((write): write is Of<K> => write.kind === kind);

export async function applyHandover(
  client: Client,
  args: { companyId: string; userId: string }
): Promise<{ applied: number; error: { message: string } | null }> {
  const { companyId, userId } = args;
  const [hub, fieldValues, rows] = await Promise.all([
    getImplementationHub(client, companyId),
    getImplementationFieldValues(client, companyId),
    getImplementationRows(client, companyId)
  ]);
  const readError = hub.error ?? fieldValues.error ?? rows.error;
  if (readError) return { applied: 0, error: readError };
  if (!hub.data) {
    return {
      applied: 0,
      error: { message: "This company has no Implementation Hub" }
    };
  }

  const fields = fieldMap(fieldValues.data ?? []);
  const writes = planHandover({
    answers: handoverAnswers(fields),
    fields,
    contacts: (hub.data.contacts as unknown as HubContacts | null) ?? {},
    tier: hub.data.tier as Tier,
    rows: rows.data ?? []
  });
  if (writes.length === 0) return { applied: 0, error: null };

  // One statement per table. The fields go last, together with the applied
  // record, so a failure part-way leaves nothing that a retry would repeat:
  // the rows already made carry their sourceRef, and the tier and contacts
  // already set are no longer empty or different.
  const newRows = ofKind(writes, "addRow");
  if (newRows.length > 0) {
    const inserted = await client.from("implementationRow").insert(
      newRows.map((write) => ({
        companyId,
        collection: write.collection,
        payload: write.payload as never,
        source: "handover" as const,
        sourceRef: write.sourceRef,
        createdBy: userId
      }))
    );
    if (inserted.error) return { applied: 0, error: inserted.error };
  }

  const tier = ofKind(writes, "setTier").at(-1)?.tier;
  // Each contacts write carries every contact before it; the last is whole.
  const contacts = ofKind(writes, "setContacts").at(-1)?.contacts;
  if (tier || contacts) {
    const updated = await updateImplementationHub(client, companyId, {
      ...(tier ? { tier } : {}),
      ...(contacts ? { contacts } : {}),
      userId
    });
    if (updated.error) return { applied: 0, error: updated.error };
  }

  const updatedAt = datetime.timestamp();
  const recorded = await client.from("implementationFieldValue").upsert(
    [
      ...ofKind(writes, "setField").map((write) => ({
        fieldKey: write.fieldKey,
        value: write.value
      })),
      {
        fieldKey: HANDOVER_APPLIED_KEY,
        value: appliedHandoverValue(fields, writes)
      }
    ].map((field) => ({
      companyId,
      ...field,
      createdBy: userId,
      updatedBy: userId,
      updatedAt
    })),
    { onConflict: "companyId, fieldKey" }
  );
  if (recorded.error) return { applied: 0, error: recorded.error };

  return { applied: writes.length, error: null };
}
