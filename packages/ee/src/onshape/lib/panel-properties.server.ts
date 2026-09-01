import type { OnshapePropertyValue } from "../panel/properties";
import {
  parseProperties,
  partPropertiesFromElementMetadata
} from "../panel/properties";
import type { OnshapeClient } from "./client";
import type { OnshapeDocument } from "./document.type";

/**
 * Per-part property values for one element, quota-frugally: one metadata read
 * at part depth (`depth=2` nests `parts.items[]` — verified live 2026-08-31),
 * plus one read per requested part that payload does not carry (dev-cached
 * either way). Onshape's depth semantics are loosely documented, so the shape
 * is probed at runtime rather than assumed.
 */
export async function readPartProperties(
  client: OnshapeClient,
  document: OnshapeDocument,
  elementId: string,
  partIds: string[]
): Promise<Map<string, OnshapePropertyValue[]>> {
  const byPartId =
    partPropertiesFromElementMetadata(
      await client.getElementMetadataWithParts(document, elementId)
    ) ?? new Map<string, OnshapePropertyValue[]>();

  // The nested payload can carry only some of the requested parts; taking it
  // wholesale would drop the rest's mapped fields from the plan with no
  // signal, so a partial payload degrades to extra reads rather than lost
  // data.
  for (const partId of [...new Set(partIds)]) {
    if (byPartId.has(partId)) continue;
    try {
      byPartId.set(
        partId,
        parseProperties(
          await client.getPartMetadata(document, elementId, partId)
        )
      );
    } catch {
      // A part without readable metadata simply has no mapped values; the
      // push itself is not blocked on properties.
    }
  }
  return byPartId;
}
