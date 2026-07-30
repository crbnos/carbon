import { getLogger } from "@carbon/logger";
import type { MomentKey, MomentPayload } from "@carbon/workflows";
import { nanoid } from "nanoid";
import { trigger } from "../trigger";

const log = getLogger("lib", "workflows");

/**
 * Announce a business moment a row change cannot express, after its write has
 * committed. Never throws into the caller — a lost moment beats a failed action.
 */
export async function raiseMoment<K extends MomentKey>(
  key: K,
  payload: {
    outputs: MomentPayload<K>;
    companyId: string;
    /** `auth.uid()` of the actor; null for service-role / background writes. */
    actorId: string | null;
  }
): Promise<void> {
  // One id serves as payload field, Inngest event id, and the matcher's
  // sourceEventId (`moment:<id>`), so a double send dedupes at both ends.
  const momentId = nanoid();
  try {
    await trigger(
      "workflow-moment",
      { momentId, moment: key, ...payload },
      { id: momentId }
    );
  } catch (err) {
    log.error("Failed to raise workflow moment", {
      moment: key,
      momentId,
      err
    });
  }
}
