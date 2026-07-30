import { getLogger } from "@carbon/logger";
import type { MomentKey, MomentPayload } from "@carbon/workflows";
import { nanoid } from "nanoid";
import { trigger } from "../trigger";

const log = getLogger("lib", "workflows");

/**
 * Announce a business moment a row change cannot express, after its write has
 * committed. Declarations live in `@carbon/workflows`; phase 3 adds the listener.
 *
 * Never throws into the caller — losing a moment is a missed workflow, whereas
 * failing the caller would break a business action that already committed.
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
  // Sender-set idempotency: the same id is the payload field, the matcher's
  // sourceEventId (`moment:<id>`), and the Inngest event id, so a double send
  // is suppressed upstream and deduped downstream.
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
