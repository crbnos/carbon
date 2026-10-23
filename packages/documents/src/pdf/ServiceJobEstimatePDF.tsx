// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import type { Company } from "../types";
import { useTw } from "./blocks/tw";
import { Header, Template } from "./components";

/** One priced line of the estimate, already formatted by the route. */
export interface ServiceJobEstimateLine {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface ServiceJobEstimate {
  serviceJobId: string;
  /** The day the estimate was printed, formatted. */
  date: string;
  customerName: string | null;
  siteName: string | null;
  siteAddress: string | null;
  itemName: string | null;
  serial: string | null;
  laborWarranty: string | null;
  partsWarranty: string | null;
  lines: ServiceJobEstimateLine[];
  total: string;
}

interface ServiceJobEstimatePDFProps {
  company: Company;
  estimate: ServiceJobEstimate;
}

// Column widths shared by the header and every row (sum to 12/12).
const COL_DESCRIPTION = "w-6/12 pr-4";
const COL_QUANTITY = "w-2/12 text-right pr-4";
const COL_PRICE = "w-2/12 text-right pr-4";
const COL_AMOUNT = "w-2/12 text-right";

/**
 * A service job's estimate: the customer, the site, the unit and its
 * warranty, then the estimate lines at their prices, and the total.
 * Hand-built (no template engine), like the project Reader.
 */
export const ServiceJobEstimatePDF = ({
  company,
  estimate
}: ServiceJobEstimatePDFProps) => {
  const title = `Estimate ${estimate.serviceJobId}`;
  return (
    <Template
      title={title}
      meta={{ author: "Carbon", keywords: "service estimate", subject: title }}
      footerDocumentId={estimate.serviceJobId}
    >
      <Header
        company={company}
        title="Estimate"
        documentId={estimate.serviceJobId}
      />
      <EstimateBody estimate={estimate} />
    </Template>
  );
};

/** The body, inside `Template` so it reads the document theme. */
const EstimateBody = ({ estimate }: { estimate: ServiceJobEstimate }) => {
  const tw = useTw();

  const facts: { label: string; lines: string[] }[] = [
    {
      label: "Customer",
      lines: [
        estimate.customerName,
        estimate.siteName,
        estimate.siteAddress
      ].filter((line): line is string => Boolean(line))
    },
    {
      label: "Unit",
      lines: [
        estimate.itemName,
        estimate.serial ? `Serial ${estimate.serial}` : null
      ].filter((line): line is string => Boolean(line))
    },
    {
      label: "Warranty",
      lines: [
        `Labor: ${estimate.laborWarranty ?? "None"}`,
        `Parts: ${estimate.partsWarranty ?? "None"}`
      ]
    },
    { label: "Date", lines: [estimate.date] }
  ];

  return (
    <View style={tw("flex flex-col text-xs text-gray-800")}>
      <View style={tw("flex flex-row gap-6 mb-6")}>
        {facts.map((fact) => (
          <View key={fact.label} style={tw("flex flex-col flex-1")}>
            <Text
              style={tw("font-bold text-gray-600 uppercase text-[8px] mb-1")}
            >
              {fact.label}
            </Text>
            {fact.lines.map((line) => (
              <Text key={line}>{line}</Text>
            ))}
          </View>
        ))}
      </View>

      <View
        style={tw(
          "flex flex-row py-2 px-[6px] border-t border-b border-gray-300 font-bold uppercase text-[8px] text-gray-600"
        )}
      >
        <Text style={tw(COL_DESCRIPTION)}>Work</Text>
        <Text style={tw(COL_QUANTITY)}>Quantity</Text>
        <Text style={tw(COL_PRICE)}>Unit Price</Text>
        <Text style={tw(COL_AMOUNT)}>Amount</Text>
      </View>

      {estimate.lines.map((line, index) => (
        <View
          key={index}
          style={tw("flex flex-row py-2 px-[6px] border-b border-gray-200")}
          wrap={false}
        >
          <Text style={tw(COL_DESCRIPTION)}>{line.description}</Text>
          <Text style={tw(COL_QUANTITY)}>{line.quantity}</Text>
          <Text style={tw(COL_PRICE)}>{line.unitPrice}</Text>
          <Text style={tw(COL_AMOUNT)}>{line.amount}</Text>
        </View>
      ))}

      <View
        style={tw("flex flex-row py-3 px-[6px] font-bold text-sm")}
        wrap={false}
      >
        <Text style={tw("w-10/12 pr-4 text-right")}>Total</Text>
        <Text style={tw(COL_AMOUNT)}>{estimate.total}</Text>
      </View>
      <Text style={tw("text-[8px] text-gray-500")}>
        An estimate, not an invoice. The invoice bills the work done.
      </Text>
    </View>
  );
};

export default ServiceJobEstimatePDF;
