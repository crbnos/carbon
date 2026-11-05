// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import { type DocumentBlock, issueTexts, makeText } from "../../../template";
import { useTw } from "../tw";
import type { Associations, IssueData } from "./types";
import { buildIssueAssociationVars } from "./vars";

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

/** Groups that render as a plain label + value, in order. */
const SIMPLE_GROUPS: {
  key: keyof Associations;
  label: AssociationTextKey;
  value: AssociationTextKey;
}[] = [
  { key: "customers", label: "customer", value: "customerValue" },
  { key: "suppliers", label: "supplier", value: "supplierValue" },
  { key: "jobOperations", label: "jobOperation", value: "jobOperationValue" },
  {
    key: "purchaseOrderLines",
    label: "purchaseOrder",
    value: "purchaseOrderValue"
  },
  { key: "salesOrderLines", label: "salesOrder", value: "salesOrderValue" },
  { key: "shipmentLines", label: "shipment", value: "shipmentValue" },
  { key: "receiptLines", label: "receipt", value: "receiptValue" },
  {
    key: "trackedEntities",
    label: "trackedEntity",
    value: "trackedEntityValue"
  }
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
          {associations.items?.map((item) => {
            const row = data.values.row(
              "association",
              item.id,
              buildIssueAssociationVars(item)
            );
            return (
              <View key={item.id} style={rowStyle}>
                <Text style={tw("w-1/4 font-bold text-gray-600")}>
                  {t("item")}
                </Text>
                <Text style={tw("text-gray-800")}>{t("itemValue", row)}</Text>
                {t.prints("disposition", row) ? (
                  <>
                    <Text style={tw("text-gray-400")}>-</Text>
                    <Text style={tw("text-gray-800")}>
                      {t("disposition", row)}
                    </Text>
                  </>
                ) : null}
                {t.prints("qty", row) ? (
                  <>
                    <Text style={tw("text-gray-400")}>-</Text>
                    <Text style={tw("text-gray-800")}>{t("qty", row)}</Text>
                  </>
                ) : null}
              </View>
            );
          })}
          {SIMPLE_GROUPS.flatMap(({ key, label, value }) =>
            (associations[key] ?? []).map((row) => (
              <Row
                key={row.id}
                label={t(label)}
                value={t(
                  value,
                  data.values.row(
                    "association",
                    row.id,
                    buildIssueAssociationVars(row)
                  )
                )}
              />
            ))
          )}
        </View>
      </View>
    </View>
  );
}
