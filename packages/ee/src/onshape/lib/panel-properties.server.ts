// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getLogger } from "@carbon/logger";
import { firstOwnAssemblyPart } from "../panel/bom";
import type { OnshapePropertyValue } from "../panel/properties";
import {
  parseProperties,
  partPropertiesFromElementMetadata
} from "../panel/properties";
import { OnshapeApiError, type OnshapeClient } from "./client";
import type { OnshapeDocument, OnshapeWVMType } from "./document.type";

const logger = getLogger("ee", "onshape", "part-properties");

/**
 * One element metadata read at `depth=2`, plus one read per requested part that
 * payload lacks. Onshape's depth semantics are loosely documented, so the
 * nested shape is probed rather than assumed.
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
      // Only a 404 means "no values"; any other failure fails the plan rather
      // than push stale mapped fields as current.
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

/**
 * The assembly's own properties plus one of its parts', since part-scoped
 * properties never show on the assembly element. The part comes from the
 * assembly definition (cheaper than the BOM); a failed read keeps the own list.
 */
export async function readAssemblyProperties(
  client: OnshapeClient,
  document: OnshapeDocument,
  elementId: string
): Promise<OnshapePropertyValue[]> {
  const own = parseProperties(
    await client.getElementMetadata(document, elementId)
  );
  try {
    const part = firstOwnAssemblyPart(
      await client.getAssemblyDefinitionIn(document, elementId)
    );
    if (!part) return own;
    const partDocument: OnshapeDocument | null =
      part.wvm && part.wvmId
        ? {
            documentId: part.documentId,
            wvm: part.wvm as OnshapeWVMType,
            wvmId: part.wvmId
          }
        : part.documentId === document.documentId
          ? document
          : null;
    if (!partDocument) return own;
    const partProperties = parseProperties(
      await client.getPartMetadata(partDocument, part.elementId, part.partId)
    );
    const seen = new Set(own.map((property) => property.propertyId));
    return [
      ...own,
      ...partProperties.filter((property) => !seen.has(property.propertyId))
    ];
  } catch (error) {
    logger.warn("Failed to read an assembly part's properties", {
      documentId: document.documentId,
      elementId,
      error
    });
    return own;
  }
}
