// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import type { Company } from "../types";
import { useTw } from "./blocks/tw";
import { Header, Template } from "./components";

/** One printed row: an SF 1443 line or a PBP value, already formatted. */
export interface ContractFinancingRow {
  line: string;
  label: string;
  value: string;
  /** The reason of an override, printed under the line. */
  note?: string | null;
}

/** One billed performance-based payment event, already formatted. */
export interface ContractFinancingEventRow {
  code: string;
  description: string;
  clin: string;
  amount: string;
}

interface ContractFinancingRequestPDFProps {
  company: Company;
  title: string;
  /** Section I: label and value pairs. */
  identification: { label: string; value: string }[];
  sections: { title: string; rows: ContractFinancingRow[] }[];
  events?: ContractFinancingEventRow[];
  documentId: string;
}

/**
 * A contract financing request as a PDF: an SF 1443 (sections I to III, with
 * line 27 left for the contracting officer) or a performance-based payment
 * request (the events and the DoD values 1a to 2). The user enters it in
 * WAWF. Hand-built, like the project Reader: the route formats every value.
 */
export const ContractFinancingRequestPDF = ({
  company,
  title,
  identification,
  sections,
  events,
  documentId
}: ContractFinancingRequestPDFProps) => (
  <Template
    title={title}
    meta={{ author: "Carbon", keywords: "financing", subject: title }}
    footerDocumentId={documentId}
  >
    <Header company={company} title={title} />
    <RequestBody
      identification={identification}
      sections={sections}
      events={events}
    />
  </Template>
);

const RequestBody = ({
  identification,
  sections,
  events
}: Pick<
  ContractFinancingRequestPDFProps,
  "identification" | "sections" | "events"
>) => {
  const tw = useTw();
  return (
    <View style={tw("flex flex-col gap-4 text-xs text-gray-800")}>
      <View style={tw("flex flex-col gap-1")}>
        {identification.map((row) => (
          <View key={row.label} style={tw("flex flex-row gap-2")}>
            <Text style={tw("w-40 text-gray-500")}>{row.label}</Text>
            <Text>{row.value}</Text>
          </View>
        ))}
      </View>
      {events && events.length > 0 ? (
        <View style={tw("flex flex-col")}>
          {events.map((event) => (
            <View
              key={event.code}
              wrap={false}
              style={tw("flex flex-row gap-2 border-b border-gray-200 py-1")}
            >
              <Text style={tw("w-16")}>{event.code}</Text>
              <Text style={tw("flex-1")}>{event.description}</Text>
              <Text style={tw("w-16")}>{event.clin}</Text>
              <Text style={tw("w-24 text-right")}>{event.amount}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {sections.map((section) => (
        <View key={section.title} style={tw("flex flex-col")}>
          <Text style={tw("mb-1 font-bold text-gray-600")}>
            {section.title}
          </Text>
          {section.rows.map((row) => (
            <View
              key={row.line}
              wrap={false}
              style={tw("flex flex-row gap-2 border-b border-gray-200 py-1")}
            >
              <Text style={tw("w-10 text-gray-500")}>{row.line}</Text>
              <View style={tw("flex flex-1 flex-col")}>
                <Text>{row.label}</Text>
                {row.note ? (
                  <Text style={tw("text-[8px] text-gray-500")}>{row.note}</Text>
                ) : null}
              </View>
              <Text style={tw("w-28 text-right")}>{row.value}</Text>
            </View>
          ))}
        </View>
      ))}
      <Text style={tw("text-[8px] text-gray-500")}>
        Prepared in Carbon. Enter this request in WAWF.
      </Text>
    </View>
  );
};

export default ContractFinancingRequestPDF;
