import { getLogger } from "@carbon/logger";
import type { OnshapeApiError } from "./client";

const logger = getLogger("ee", "onshape", "panel");

/**
 * What a panel route says when a call to Onshape fails.
 *
 * The client keeps axios's own text on a transport failure — "Onshape request
 * failed: timeout of 60000ms exceeded" — which is right for a log and wrong for
 * a person. Every panel route used to forward that string verbatim, so the most
 * common failure in the product, a cold BOM read, reached the user as a raw
 * timeout when the true cause is Onshape building the BOM on demand and the
 * fix is to press Refresh. This maps each cause to a sentence that says what
 * happened and what to do — worded to fit whichever button sits beside it,
 * Retry in a load failure or Refresh in a header. The original text is logged here, so a translated
 * message never costs the detail someone debugging needs.
 *
 * Status codes are chosen for the panel, not echoed from Onshape. In
 * particular Onshape's own 401/403 must never reach the panel as a 401: the
 * panel reads a 401 as "your Carbon session is gone" and signs the user out,
 * when the thing actually rejected is Carbon's stored Onshape grant.
 */
export type OnshapeFailure = {
  status: 404 | 422 | 429 | 502 | 504;
  body: { error: string; retryAfterSeconds?: number };
};

/** A BOM read gets its own timeout wording: on-demand generation is the cause. */
export type OnshapeRead = "bom" | "other";

export function onshapeFailure(
  error: unknown,
  read: OnshapeRead = "other"
): OnshapeFailure {
  // Read structurally, not with `instanceof`: importing the client class
  // loads the environment, which this pure mapping has no reason to need.
  const apiError = error as Partial<OnshapeApiError> | null;
  const status =
    typeof apiError?.status === "number" ? apiError.status : undefined;
  const message = error instanceof Error ? error.message : String(error);
  logger.warn("Onshape call failed", { read, status, message });

  if (status === undefined) {
    // No response at all. Axios reports its own timeout as "timeout of Nms
    // exceeded"; anything else is the network, DNS or a refused connection.
    if (/timeout/i.test(message)) {
      return {
        status: 504,
        body: {
          error:
            read === "bom"
              ? "Onshape is still building this BOM. It can take a minute the first time — try again shortly."
              : "Onshape didn't answer in time. Try again."
        }
      };
    }
    return {
      status: 502,
      body: {
        error: "Carbon couldn't reach Onshape. Try again."
      }
    };
  }

  if (status === 429) {
    const retryAfterSeconds =
      typeof apiError?.retryAfterSeconds === "number"
        ? apiError.retryAfterSeconds
        : undefined;
    return {
      status: 429,
      body: {
        error: `Onshape is rate-limiting this connection. Try again in ${
          retryAfterSeconds ?? 60
        } seconds.`,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
      }
    };
  }

  if (status === 401 || status === 403) {
    return {
      status: 422,
      body: {
        error:
          "Onshape rejected Carbon's connection. Reconnect Onshape in Carbon's integration settings."
      }
    };
  }

  if (status === 404) {
    return {
      status: 404,
      body: {
        error: "That Onshape document, version or element no longer exists."
      }
    };
  }

  return {
    status: 502,
    body: {
      error: `Onshape returned an error (HTTP ${status}). Try again; if it keeps happening, contact support.`
    }
  };
}
