// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import { useTw } from "../tw";
import type { PurchaseOrderData } from "./types";

/**
 * The approver's signature, name and approval date. Prints nothing until the
 * order is approved, so it can sit on every saved template.
 */
export function ApprovalBlock({ data }: { data: PurchaseOrderData }) {
  const tw = useTw();
  const { approval, locale } = data;
  if (!approval) return null;

  return (
    <View wrap={false} style={tw("mt-4 mb-4 w-[220px]")}>
      <Text style={tw("text-[9px] font-bold uppercase text-gray-600 mb-1")}>
        Approved By
      </Text>
      <View style={tw("h-[40px] justify-end")}>
        {approval.signature ? (
          <Image
            src={approval.signature}
            style={{ maxHeight: 40, maxWidth: 200, objectFit: "contain" }}
          />
        ) : null}
      </View>
      <View style={tw("border-t border-gray-400 mt-1 pt-1")}>
        <Text style={tw("text-[10px] text-gray-800")}>
          {approval.approvedBy ?? ""}
        </Text>
        <Text style={tw("text-[9px] text-gray-600")}>
          {formatDate(approval.approvedDate, undefined, locale)}
        </Text>
      </View>
    </View>
  );
}
