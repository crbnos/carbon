// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getLogger } from "@carbon/logger";
import type { OnshapeApiError } from "./client";

const logger = getLogger("ee", "onshape", "panel");

/**
 * The status and user-facing message a panel route returns for a failed Onshape
 * call. Onshape's 401/403 maps to 422: the panel reads a 401 as an expired
 * Carbon session and signs the user out.
 */
export type OnshapeFailure = {
  status: 404 | 422 | 429 | 502 | 504;
  body: { error: string; retryAfterSeconds?: number };
};

/** A BOM read gets its own timeout wording: Onshape builds BOMs on demand. */
export type OnshapeRead = "bom" | "other";

export function onshapeFailure(
  error: unknown,
  read: OnshapeRead = "other"
): OnshapeFailure {
  // Structural read: `instanceof` would import the client, which loads the env.
  const apiError = error as Partial<OnshapeApiError> | null;
  const status =
    typeof apiError?.status === "number" ? apiError.status : undefined;
  const message = error instanceof Error ? error.message : String(error);
  logger.warn("Onshape call failed", { read, status, message });

  if (status === undefined) {
    // No response: axios says "timeout of Nms exceeded"; else the network.
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

  // Onshape answers 402 once the OAuth app owner's yearly API limit is used up;
  // a retry cannot help.
  if (status === 402) {
    return {
      status: 502,
      body: {
        error:
          "Onshape refused the request: the yearly API limit for Carbon's Onshape app is used up. Ask your Carbon administrator to raise it with Onshape."
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
