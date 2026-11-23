// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { randomBytes } from "node:crypto";
import { redis } from "@carbon/kv";
import { datetime } from "@carbon/utils";
import { parseAbsolute } from "@internationalized/date";
import type { OnshapeBomNode } from "../panel/bom";
import type { AssemblyPlan, PartPlan, ReleasePlan } from "../panel/plan";

// Reviewed push plans in Redis. A plan holds every Onshape read the push needs,
// so apply makes no Onshape call; GETDEL makes it one-shot, so a double-click
// cannot write twice.

export const PANEL_PLAN_TTL_SECONDS = 15 * 60;

const PLAN_PREFIX = "cpp_";
const PLAN_PATTERN = /^cpp_[A-Za-z0-9_-]{32}$/;

export type StoredAssemblyPlan = AssemblyPlan & {
  /** parseBomTree().lines at plan time. */
  nodes: OnshapeBomNode[];
};

export type StoredReleasePlan = ReleasePlan & {
  /** Per released assembly element; null (unread) leaves that method alone. */
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
 * Null when Redis did not take the write: `@carbon/kv` resolves null during an
 * outage, and an unstored plan must fail the PLAN request, not the later apply.
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

/** Reads without consuming: a 422 on the user's edits keeps the plan. */
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
 * Removes the plan atomically. Expired, taken, malformed and foreign plans all
 * return null, indistinguishably.
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
