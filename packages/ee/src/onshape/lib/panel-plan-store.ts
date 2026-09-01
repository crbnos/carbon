import { randomBytes } from "node:crypto";
import { redis } from "@carbon/kv";
import { datetime } from "@carbon/utils";
import { parseAbsolute } from "@internationalized/date";
import type { OnshapeBomNode } from "../panel/bom";
import type { AssemblyPlan, PartPlan, ReleasePlan } from "../panel/plan";

/**
 * Plans the panel has shown a user and not yet applied.
 *
 * A plan is the whole decision — every Onshape read the push needs is
 * already in it — so apply can run minutes later without touching Onshape's
 * quota. It is opaque (`cpp_…`), short-lived, bound to the user and company
 * that planned it, and taken with GETDEL so one plan applies at most once: a
 * double-click cannot write twice, and a failed apply means "review again".
 */

export const PANEL_PLAN_TTL_SECONDS = 15 * 60;

const PLAN_PREFIX = "cpp_";
// 24 random bytes → 32 base64url characters.
const PLAN_PATTERN = /^cpp_[A-Za-z0-9_-]{32}$/;

/** Server-only additions the UI never sees but apply consumes. */
export type StoredAssemblyPlan = AssemblyPlan & {
  /** parseBomTree().lines at plan time — the BOM apply walks. */
  nodes: OnshapeBomNode[];
};

export type StoredReleasePlan = ReleasePlan & {
  /**
   * Top-level BOM lines per released assembly element, read at its version;
   * null when the review could not read it, so apply leaves that method alone.
   */
  bomLinesByElementId: Record<string, OnshapeBomNode[] | null>;
};

export type StoredPanelPlan = {
  companyId: string;
  userId: string;
  createdAt: string;
  plan: PartPlan | StoredAssemblyPlan | StoredReleasePlan;
};

function keyFor(planId: string) {
  return `panel-plan:${planId}`;
}

export function isPanelPlanId(value: unknown): value is string {
  return typeof value === "string" && PLAN_PATTERN.test(value);
}

/**
 * Store a plan. Null when Redis did not take it: `@carbon/kv` is fail-soft
 * (a `set` during an outage resolves null instead of throwing), and a plan
 * that was never stored must fail the PLAN request, not the later APPLY.
 */
export async function createPanelPlan(
  stored: Omit<StoredPanelPlan, "createdAt">
): Promise<{ planId: string; expiresAt: string } | null> {
  const planId = `${PLAN_PREFIX}${randomBytes(24).toString("base64url")}`;
  const createdAt = datetime.timestamp();
  const written = await redis.set(
    keyFor(planId),
    JSON.stringify({ ...stored, createdAt }),
    "EX",
    PANEL_PLAN_TTL_SECONDS
  );
  if (written !== "OK") return null;
  return {
    planId,
    expiresAt: parseAbsolute(createdAt, "UTC")
      .add({ seconds: PANEL_PLAN_TTL_SECONDS })
      .toAbsoluteString()
  };
}

/**
 * Read a plan without consuming it — for validating the user's edits before
 * anything is written. A 422 must leave the plan in place so the user can fix
 * a field and apply again without a second Onshape read; only the write path
 * takes it.
 */
export async function peekPanelPlan(
  planId: string,
  owner: { companyId: string; userId: string }
): Promise<StoredPanelPlan | null> {
  if (!isPanelPlanId(planId)) return null;
  const raw = await redis.get(keyFor(planId));
  if (!raw) return null;
  let stored: StoredPanelPlan;
  try {
    stored = JSON.parse(raw) as StoredPanelPlan;
  } catch {
    await redis.del(keyFor(planId));
    return null;
  }
  if (stored.companyId !== owner.companyId || stored.userId !== owner.userId) {
    return null;
  }
  return stored;
}

/**
 * Take a plan for apply: removed atomically, so a second apply of the same
 * plan finds nothing. Null when it expired, was already taken, is malformed,
 * or belongs to another user or company (indistinguishable on purpose).
 */
export async function takePanelPlan(
  planId: string,
  owner: { companyId: string; userId: string }
): Promise<StoredPanelPlan | null> {
  if (!isPanelPlanId(planId)) return null;
  const raw = await redis.getdel(keyFor(planId));
  if (!raw) return null;
  let stored: StoredPanelPlan;
  try {
    stored = JSON.parse(raw) as StoredPanelPlan;
  } catch {
    return null;
  }
  if (stored.companyId !== owner.companyId || stored.userId !== owner.userId) {
    return null;
  }
  return stored;
}
