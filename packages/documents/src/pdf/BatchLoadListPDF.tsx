import { formatDate } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import type { Company } from "../types";
import { tw } from "./blocks/jobTraveler/tw";
import { Header, Template } from "./components";

// Shared column widths so the header and body rows can never drift out of
// alignment (the MaterialsBlock convention: widths sum to 12/12; spacing via
// in-cell right padding, never a flex gap).
const COL_JOB = "w-2/12 text-left pr-4";
const COL_ITEM = "w-3/12 text-left pr-4";
const COL_DESCRIPTION = "w-5/12 text-left pr-4";
const COL_QUANTITY = "w-2/12 text-right";

export interface BatchLoadListMember {
  id: string;
  jobReadableId: string | null;
  itemReadableId: string | null;
  itemDescription: string | null;
  operationDescription: string | null;
  quantity: number | null;
}

interface BatchLoadListPDFProps {
  company: Company;
  batch: {
    readableId: string | null;
    status: string | null;
    createdAt: string | null;
  };
  processName: string | null;
  workCenterName: string | null;
  members: BatchLoadListMember[];
  locale?: string;
}

/**
 * The batch load sheet an operator works a shared run from: which jobs' parts
 * are in this furnace load / laser nest / plating rack, and how many of each.
 * Hand-built (no template engine) — a fixed operational document, not a
 * customer-facing one.
 */
export const BatchLoadListPDF = ({
  company,
  batch,
  processName,
  workCenterName,
  members,
  locale
}: BatchLoadListPDFProps) => {
  const totalQuantity = members.reduce((sum, m) => sum + (m.quantity ?? 0), 0);

  const tableHeader = (
    <View
      style={tw(
        "flex flex-row justify-between items-center py-3 px-[6px] border-t border-b border-gray-300 font-bold uppercase"
      )}
    >
      <Text style={tw(COL_JOB)}>Job</Text>
      <Text style={tw(COL_ITEM)}>Item</Text>
      <Text style={tw(COL_DESCRIPTION)}>Description</Text>
      <Text style={tw(COL_QUANTITY)}>Quantity</Text>
    </View>
  );

  return (
    <Template
      title="Batch Load List"
      meta={{
        author: "Carbon",
        keywords: "batch load list",
        subject: "Batch Load List"
      }}
      footerDocumentId={batch.readableId}
    >
      <Header
        company={company}
        title="Batch Load List"
        documentId={batch.readableId}
      />

      <View style={tw("flex flex-row gap-8 mb-4 text-xs")}>
        {processName && (
          <View style={tw("flex flex-col")}>
            <Text style={tw("font-bold text-gray-500 uppercase text-[8px]")}>
              Process
            </Text>
            <Text>{processName}</Text>
          </View>
        )}
        {workCenterName && (
          <View style={tw("flex flex-col")}>
            <Text style={tw("font-bold text-gray-500 uppercase text-[8px]")}>
              Work Center
            </Text>
            <Text>{workCenterName}</Text>
          </View>
        )}
        {batch.createdAt && (
          <View style={tw("flex flex-col")}>
            <Text style={tw("font-bold text-gray-500 uppercase text-[8px]")}>
              Created
            </Text>
            <Text>
              {formatDate(batch.createdAt.slice(0, 10), undefined, locale)}
            </Text>
          </View>
        )}
        <View style={tw("flex flex-col")}>
          <Text style={tw("font-bold text-gray-500 uppercase text-[8px]")}>
            Jobs
          </Text>
          <Text>{members.length}</Text>
        </View>
      </View>

      <View style={tw("mb-6 text-xs")}>
        {members.map((member, index) => {
          const row = (
            <View
              style={tw(
                "flex flex-row justify-between items-start border-b border-gray-300 py-3 px-[6px]"
              )}
              wrap={false}
            >
              <Text style={tw(`${COL_JOB} font-bold`)}>
                {member.jobReadableId ?? ""}
              </Text>
              <Text style={tw(COL_ITEM)}>{member.itemReadableId ?? ""}</Text>
              <Text style={tw(COL_DESCRIPTION)}>
                {member.itemDescription ?? member.operationDescription ?? ""}
              </Text>
              <Text style={tw(COL_QUANTITY)}>{member.quantity ?? 0}</Text>
            </View>
          );

          // Bind the table header to the first row so it can never be orphaned
          // at the bottom of a page (the MaterialsBlock trick).
          if (index === 0) {
            return (
              <View key={member.id} wrap={false} minPresenceAhead={80}>
                {tableHeader}
                {row}
              </View>
            );
          }

          return <View key={member.id}>{row}</View>;
        })}
        <View
          style={tw(
            "flex flex-row justify-between items-center py-3 px-[6px] font-bold"
          )}
          wrap={false}
        >
          <Text style={tw(COL_JOB)} />
          <Text style={tw(COL_ITEM)} />
          <Text style={tw(COL_DESCRIPTION)}>Total</Text>
          <Text style={tw(COL_QUANTITY)}>{totalQuantity}</Text>
        </View>
      </View>
    </Template>
  );
};
