import { getLogger } from "@carbon/logger";
import type { MomentKey, MomentPayload } from "@carbon/workflows";
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
  try {
    await trigger("workflow-moment", { moment: key, ...payload });
  } catch (err) {
    log.error("Failed to raise workflow moment", { moment: key, err });
  }
}
