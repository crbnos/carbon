// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import type { Company } from "../types";
import { useTw } from "./blocks/tw";
import { Header, Template } from "./components";

/** One priced line of a node, already formatted by the route. */
export interface ServiceEstimateLine {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

/** One node of the work tree, in tree order, with its priced lines. */
export interface ServiceEstimateNode {
  id: string;
  /** The tree level, the root is 0. */
  depth: number;
  readableId: string;
  name: string;
  isFixedPrice: boolean;
  lines: ServiceEstimateLine[];
  /** The node's own lines, formatted; empty when it has none. */
  total: string;
}

export interface ServiceEstimate {
  serviceOrderId: string;
  /** The day the estimate was printed, formatted. */
  date: string;
  customerName: string | null;
  siteName: string | null;
  siteAddress: string | null;
  itemName: string | null;
  serial: string | null;
  laborWarranty: string | null;
  partsWarranty: string | null;
  nodes: ServiceEstimateNode[];
  total: string;
}

interface ServiceEstimatePDFProps {
  company: Company;
  estimate: ServiceEstimate;
}

// Column widths shared by the header and every row (sum to 12/12).
const COL_DESCRIPTION = "w-6/12 pr-4";
const COL_QUANTITY = "w-2/12 text-right pr-4";
const COL_PRICE = "w-2/12 text-right pr-4";
const COL_AMOUNT = "w-2/12 text-right";

/**
 * A service order's estimate: the customer, the site, the unit and its
 * warranty, then the work tree in order with each node's plan lines at sale
 * prices, and the total. A fixed-price node is one line at its price.
 * Hand-built (no template engine), like the project Reader.
 */
export const ServiceEstimatePDF = ({
  company,
  estimate
}: ServiceEstimatePDFProps) => {
  const title = `Estimate ${estimate.serviceOrderId}`;
  return (
    <Template
      title={title}
      meta={{ author: "Carbon", keywords: "service estimate", subject: title }}
      footerDocumentId={estimate.serviceOrderId}
    >
      <Header
        company={company}
        title="Estimate"
        documentId={estimate.serviceOrderId}
      />
      <EstimateBody estimate={estimate} />
    </Template>
  );
};

/** The body, inside `Template` so it reads the document theme. */
const EstimateBody = ({ estimate }: { estimate: ServiceEstimate }) => {
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

      {estimate.nodes.map((node) => (
        <View key={node.id} style={tw("flex flex-col")}>
          <View
            style={{
              ...tw(
                "flex flex-row py-2 px-[6px] border-b border-gray-200 font-bold"
              ),
              paddingLeft: 6 + node.depth * 12
            }}
            wrap={false}
            minPresenceAhead={20}
          >
            <Text style={tw("w-10/12 pr-4")}>
              <Text style={tw("text-gray-500")}>{node.readableId} </Text>
              {node.name}
              {node.isFixedPrice ? (
                <Text style={tw("text-gray-500")}> (fixed price)</Text>
              ) : null}
            </Text>
            <Text style={tw(COL_AMOUNT)}>{node.total}</Text>
          </View>
          {node.isFixedPrice
            ? null
            : node.lines.map((line, index) => (
                <View
                  key={`${node.id}-${index}`}
                  style={{
                    ...tw(
                      "flex flex-row py-1 px-[6px] border-b border-gray-200"
                    ),
                    paddingLeft: 18 + node.depth * 12
                  }}
                  wrap={false}
                >
                  <Text style={tw(COL_DESCRIPTION)}>{line.description}</Text>
                  <Text style={tw(COL_QUANTITY)}>{line.quantity}</Text>
                  <Text style={tw(COL_PRICE)}>{line.unitPrice}</Text>
                  <Text style={tw(COL_AMOUNT)}>{line.amount}</Text>
                </View>
              ))}
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
        An estimate, not an invoice. Work covered by a warranty or a contract is
        billed at 0 on the invoice.
      </Text>
    </View>
  );
};

export default ServiceEstimatePDF;
