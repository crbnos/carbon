// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Image, Text, View } from "@react-pdf/renderer";
import type { ApprovalBlock as ApprovalBlockType } from "../../../template";
import {
  DEFAULT_APPROVAL_CAPTION,
  DEFAULT_APPROVAL_HEADING,
  interpolateContent
} from "../../../template";
import { Note } from "../../components";
import { hasContent } from "../resolveTerms";
import { useTw } from "../tw";
import type { PurchaseOrderData } from "./types";

/**
 * The approver's signature over a line, under a heading, with a caption the
 * template can edit (the approver and the date by default). Prints nothing
 * until the order is approved, so it can sit on every saved template.
 */
export function ApprovalBlock({
  block,
  data
}: {
  block: ApprovalBlockType;
  data: PurchaseOrderData;
}) {
  const tw = useTw();
  const { approval, vars } = data;
  if (!approval) return null;

  const heading = block.heading ?? DEFAULT_APPROVAL_HEADING;
  const showSignature = block.showSignature ?? true;
  const caption = interpolateContent(
    block.content && hasContent(block.content)
      ? block.content
      : DEFAULT_APPROVAL_CAPTION,
    vars
  );

  return (
    <View wrap={false} style={tw("mt-4 mb-4 w-[240px]")}>
      {heading.trim() ? (
        <Text style={tw("text-[9px] font-bold uppercase text-gray-600 mb-1")}>
          {heading}
        </Text>
      ) : null}
      {showSignature ? (
        <View style={tw("h-[40px] justify-end border-b border-gray-400 mb-1")}>
          {approval.signature ? (
            <Image
              src={approval.signature}
              style={{ maxHeight: 40, maxWidth: 200, objectFit: "contain" }}
            />
          ) : null}
        </View>
      ) : null}
      <Note content={caption} />
    </View>
  );
}
