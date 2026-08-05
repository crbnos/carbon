import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { runCutOptimization } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const result = await runCutOptimization(client, {
    cutListId: id,
    companyId,
    userId
  });

  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, "Failed to optimize cut list"))
    );
  }

  const payload = result.data as {
    patternCount?: number;
    yieldPct?: number;
    unplaced?: { quantity: number }[];
  } | null;

  const unplacedCount = (payload?.unplaced ?? []).reduce(
    (sum, entry) => sum + entry.quantity,
    0
  );

  // A partial plan is still worth keeping — the planner sees which pieces
  // couldn't be placed and can buy stock for them. Say so plainly.
  const message = unplacedCount
    ? `Planned ${payload?.patternCount ?? 0} stock unit(s); ${unplacedCount} piece(s) need more stock`
    : `Planned ${payload?.patternCount ?? 0} stock unit(s) at ${(payload?.yieldPct ?? 0).toFixed(1)}% yield`;

  return data({}, await flash(request, success(message)));
}
