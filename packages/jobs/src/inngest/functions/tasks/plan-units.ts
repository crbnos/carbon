import { getCarbonServiceRole } from "@carbon/auth/client.server";

/** A pre-grouped rigid body for the geometry planner's `options.units`. */
export type PlanUnit = { id: string; name: string | null; nodeIds: string[] };

/**
 * Loads the user-authored "plan as one component" overrides (`assemblyUnit`
 * rows, edited from the BOM tree UI) as the planner's `options.units`.
 *
 * That's the only unit source on this side: the planner itself auto-detects
 * detail swarms (a populated PCB's hundreds of tiny components on a board)
 * from pure geometry — see `detect_swarm_units` in `crates/planner` — so no
 * BOM walk or LLM component→BOM assignment happens here anymore.
 *
 * Best-effort: any failure returns `[]` and the planner plans every leaf
 * (plus whatever it auto-detects). Only multi-leaf units are sent; a
 * single-leaf unit is just a normal component.
 */
export async function loadPlanUnits(args: {
  modelUploadId: string;
  companyId: string;
  /**
   * Fresh regenerate: omit auto-detected swarm units (`sourceGroupId` set) so the
   * planner re-detects from geometry instead of merging the frozen grouping. The
   * rows stay in the DB (swapped later at step generation) — only THIS run skips
   * them. User-authored units (`sourceGroupId` null) are always sent.
   */
  excludeAuto?: boolean;
}): Promise<PlanUnit[]> {
  const { modelUploadId, companyId, excludeAuto } = args;
  try {
    const client = getCarbonServiceRole();
    let query = client
      .from("assemblyUnit")
      .select("id, name, componentNodeIds")
      .eq("modelUploadId", modelUploadId)
      .eq("companyId", companyId);
    if (excludeAuto) query = query.is("sourceGroupId", null);
    const authored = await query;

    return (authored.data ?? [])
      .filter((unit) => (unit.componentNodeIds ?? []).length > 1)
      .map((unit) => ({
        id: unit.id,
        name: unit.name,
        nodeIds: unit.componentNodeIds ?? []
      }));
  } catch (error) {
    console.error("loadPlanUnits failed; planning every leaf instead:", error);
    return [];
  }
}
