import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanySettings } from "~/modules/settings";
import type { plmReleaseControl } from "./items.models";

// Release-lock helpers — gate BOM/BOP mutations on a released (Production)
// revision. A Production revision is the controlled, released make method;
// changes must flow through a change order. The pending revision an ECO creates
// is Design/Prototype (NOT Production), so it stays editable.

export type ReleaseControl = (typeof plmReleaseControl)[number];

type ItemRevisionStatus = Database["public"]["Enums"]["itemRevisionStatus"];

export const LOCKED_REVISION_MESSAGE =
  "This revision is released (Production). Open a change order to modify it.";

export type LockKind =
  | "item"
  | "makeMethod"
  | "material"
  | "operation"
  | "tool"
  | "parameter";

export type RevisionLock = {
  isLocked: boolean;
  releaseControl: ReleaseControl;
  revisionStatus: ItemRevisionStatus | null;
};

export type LockCheck =
  | { ok: true; warn: false }
  | { ok: true; warn: true; message: string }
  | { ok: false; warn: false; message: string };

export function getLockVerdict(lock: {
  isLocked: boolean;
  releaseControl: ReleaseControl;
}): LockCheck {
  if (!lock.isLocked || lock.releaseControl === "off") {
    return { ok: true, warn: false };
  }
  if (lock.releaseControl === "warn") {
    return { ok: true, warn: true, message: LOCKED_REVISION_MESSAGE };
  }
  return { ok: false, warn: false, message: LOCKED_REVISION_MESSAGE };
}

// Each kind resolves entity -> item.revisionStatus in a single nested PostgREST
// select instead of walking the FK chain with sequential single-row queries.
// Every base query is scoped by companyId (defense-in-depth; the id is a global
// UUID but tenant scoping is a golden rule). The lock is advisory — RLS +
// requirePermissions are the real boundary — so a null/unresolvable status
// leaves the gate open by design (see checkRevisionLock).
async function resolveRevisionStatus(
  client: SupabaseClient<Database>,
  kind: LockKind,
  id: string,
  companyId: string
): Promise<ItemRevisionStatus | null> {
  switch (kind) {
    case "item": {
      const item = await client
        .from("item")
        .select("revisionStatus")
        .eq("id", id)
        .eq("companyId", companyId)
        .maybeSingle();
      return item.data?.revisionStatus ?? null;
    }
    case "makeMethod": {
      const makeMethod = await client
        .from("makeMethod")
        .select("item(revisionStatus)")
        .eq("id", id)
        .eq("companyId", companyId)
        .maybeSingle();
      return makeMethod.data?.item?.revisionStatus ?? null;
    }
    case "material": {
      // methodMaterial has two FKs to makeMethod (makeMethodId and
      // materialMakeMethodId) — the parent method is methodMaterial_methodId_fkey
      const material = await client
        .from("methodMaterial")
        .select("makeMethod!methodMaterial_methodId_fkey(item(revisionStatus))")
        .eq("id", id)
        .eq("companyId", companyId)
        .maybeSingle();
      return material.data?.makeMethod?.item?.revisionStatus ?? null;
    }
    case "operation": {
      const operation = await client
        .from("methodOperation")
        .select("makeMethod(item(revisionStatus))")
        .eq("id", id)
        .eq("companyId", companyId)
        .maybeSingle();
      return operation.data?.makeMethod?.item?.revisionStatus ?? null;
    }
    case "tool": {
      const tool = await client
        .from("methodOperationTool")
        .select("methodOperation(makeMethod(item(revisionStatus)))")
        .eq("id", id)
        .eq("companyId", companyId)
        .maybeSingle();
      return (
        tool.data?.methodOperation?.makeMethod?.item?.revisionStatus ?? null
      );
    }
    case "parameter": {
      const parameter = await client
        .from("methodOperationParameter")
        .select("methodOperation(makeMethod(item(revisionStatus)))")
        .eq("id", id)
        .eq("companyId", companyId)
        .maybeSingle();
      return (
        parameter.data?.methodOperation?.makeMethod?.item?.revisionStatus ??
        null
      );
    }
  }
}

async function getReleaseControl(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<ReleaseControl> {
  const settings = await getCompanySettings(client, companyId);
  return (settings.data?.plmReleaseControl ?? "enforce") as ReleaseControl;
}

// Read variant for loaders that need the raw lock state (revisionStatus +
// releaseControl) to drive read-only UI. A revision is locked ONLY when it is
// "Production".
export async function getRevisionLock(
  client: SupabaseClient<Database>,
  args: { itemId: string | null; companyId: string }
): Promise<RevisionLock> {
  const [revisionStatus, releaseControl] = await Promise.all([
    args.itemId
      ? resolveRevisionStatus(client, "item", args.itemId, args.companyId)
      : Promise.resolve(null),
    getReleaseControl(client, args.companyId)
  ]);

  return {
    isLocked: revisionStatus === "Production",
    releaseControl,
    revisionStatus
  };
}

// The single guard entry point for mutation routes: resolves the entity's
// parent item and returns the enforce/warn/off verdict. A missing/null id
// (cannot resolve) leaves the lock unlocked, so the gate is safely skipped.
export async function checkRevisionLock(
  client: SupabaseClient<Database>,
  args: { kind: LockKind; id: string | null | undefined; companyId: string }
): Promise<LockCheck> {
  const [revisionStatus, releaseControl] = await Promise.all([
    args.id
      ? resolveRevisionStatus(client, args.kind, args.id, args.companyId)
      : Promise.resolve(null),
    getReleaseControl(client, args.companyId)
  ]);

  return getLockVerdict({
    isLocked: revisionStatus === "Production",
    releaseControl
  });
}
