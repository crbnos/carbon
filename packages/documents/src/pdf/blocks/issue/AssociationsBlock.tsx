// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import { type DocumentBlock, issueTexts, makeText } from "../../../template";
import { useTw } from "../tw";
import type { Associations, IssueData } from "./types";

type AssociationTextKey = (typeof issueTexts.associations)[number]["key"];

/** A single labeled association row (label + readable id). */
function Row({ label, value }: { label: string; value: string }) {
  const tw = useTw();
  const rowStyle = tw(
    "flex flex-row gap-2 text-[10px] py-1 border-b border-gray-200"
  );
  return (
    <View style={rowStyle}>
      <Text style={tw("w-1/4 font-bold text-gray-600")}>{label}</Text>
      <Text style={tw("text-gray-800")}>{value}</Text>
    </View>
  );
}

/** Groups that render as a plain label + documentReadableId, in order. */
const SIMPLE_GROUPS: { key: keyof Associations; label: AssociationTextKey }[] =
  [
    { key: "customers", label: "customer" },
    { key: "suppliers", label: "supplier" },
    { key: "jobOperations", label: "jobOperation" },
    { key: "purchaseOrderLines", label: "purchaseOrder" },
    { key: "salesOrderLines", label: "salesOrder" },
    { key: "shipmentLines", label: "shipment" },
    { key: "receiptLines", label: "receipt" },
    { key: "trackedEntities", label: "trackedEntity" }
  ];

/** Related entities grouped by type. Renders nothing when there are none. */
export function AssociationsBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: IssueData;
}) {
  const tw = useTw();
  const t = makeText(issueTexts.associations, block, data.vars);
  const rowStyle = tw(
    "flex flex-row gap-2 text-[10px] py-1 border-b border-gray-200"
  );
  const { associations } = data;
  if (!associations) return null;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
          {t("associations")}
        </Text>
        <View style={tw("flex flex-col")}>
          {associations.items?.map((item) => (
            <View key={item.id} style={rowStyle}>
              <Text style={tw("w-1/4 font-bold text-gray-600")}>
                {t("item")}
              </Text>
              <Text style={tw("text-gray-800")}>{item.documentReadableId}</Text>
              {item.disposition ? (
                <>
                  <Text style={tw("text-gray-400")}>-</Text>
                  <Text style={tw("text-gray-800")}>{item.disposition}</Text>
                </>
              ) : null}
              {t.shows("qty") && item.quantity ? (
                <>
                  <Text style={tw("text-gray-400")}>-</Text>
                  <Text style={tw("text-gray-800")}>
                    {t("qty")} {item.quantity}
                  </Text>
                </>
              ) : null}
            </View>
          ))}
          {SIMPLE_GROUPS.flatMap(({ key, label }) =>
            (associations[key] ?? []).map((row) => (
              <Row
                key={row.id}
                label={t(label)}
                value={row.documentReadableId}
              />
            ))
          )}
        </View>
      </View>
    </View>
  );
}
