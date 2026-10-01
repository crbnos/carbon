// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getLogger } from "@carbon/logger";
import type { OnshapePropertyValue } from "../panel/properties";
import {
  parseProperties,
  partPropertiesFromElementMetadata
} from "../panel/properties";
import { OnshapeApiError, type OnshapeClient } from "./client";
import type { OnshapeDocument } from "./document.type";

const logger = getLogger("ee", "onshape", "part-properties");

/**
 * Per-part property values for one element, quota-frugally: one metadata read
 * at part depth (`depth=2` nests `parts.items[]`), plus one read per requested
 * part that payload does not carry. Onshape's depth semantics are loosely
 * documented, so the shape is probed at runtime rather than assumed.
 */
export async function readPartProperties(
  client: OnshapeClient,
  document: OnshapeDocument,
  elementId: string,
  partIds: string[],
  configuration?: string | null
): Promise<Map<string, OnshapePropertyValue[]>> {
  const byPartId =
    partPropertiesFromElementMetadata(
      await client.getElementMetadataWithParts(
        document,
        elementId,
        configuration
      )
    ) ?? new Map<string, OnshapePropertyValue[]>();

  // The nested payload can carry only some of the requested parts; taking it
  // wholesale would drop the rest's mapped fields from the plan.
  for (const partId of [...new Set(partIds)]) {
    if (byPartId.has(partId)) continue;
    try {
      byPartId.set(
        partId,
        parseProperties(
          await client.getPartMetadata(
            document,
            elementId,
            partId,
            configuration
          )
        )
      );
    } catch (error) {
      // A part Onshape no longer has simply has no mapped values. Anything
      // else — a 401, a rate limit, an outage — fails the plan: reading it as
      // "no values" would push stale mapped fields as if they were current.
      if (error instanceof OnshapeApiError && error.status === 404) {
        logger.warn("Onshape part has no metadata; no mapped values", {
          documentId: document.documentId,
          elementId,
          partId
        });
        continue;
      }
      logger.error("Failed to read Onshape part properties", {
        documentId: document.documentId,
        elementId,
        partId,
        error
      });
      throw error;
    }
  }
  return byPartId;
}
