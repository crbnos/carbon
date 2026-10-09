// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { Text, View } from "@react-pdf/renderer";
import type { Company } from "../types";
import { useTw } from "./blocks/tw";
import { Header, Note, Template } from "./components";

/** One element of the Reader, already formatted by the route. */
export interface ProjectReaderSection {
  id: string;
  /** The tree level, the root is 0. */
  level: number;
  /** The outline number: `1`, `1.2`, `1.2.3`. */
  number: string;
  readableId: string;
  name: string;
  /** The property line: type, state, owner. */
  properties: string[];
  /** The type facts: a Requirement's target and status, a Parameter's value. */
  facts: { label: string; value: string }[];
  description: JSONContent | null;
}

interface ProjectReaderPDFProps {
  company: Company;
  project: { identifier: string | null; name: string };
  sections: ProjectReaderSection[];
}

/** The heading size by tree level: level 0 is an h2, capped at h6. */
const HEADING_SIZE = [14, 12, 11, 10, 10] as const;

function headingSize(level: number): number {
  return HEADING_SIZE[Math.min(Math.max(level, 0), 4)] ?? 10;
}

/**
 * The project Reader as a PDF: one section per element in tree order, with
 * the outline number, readable id and name, the property line, the type
 * facts and the description. The head of a section never splits across
 * pages. Hand-built (no template engine), like the batch
 * list: an internal document, not a customer one.
 */
export const ProjectReaderPDF = ({
  company,
  project,
  sections
}: ProjectReaderPDFProps) => {
  const title = project.identifier
    ? `${project.identifier} ${project.name}`
    : project.name;

  return (
    <Template
      title={title}
      meta={{ author: "Carbon", keywords: "project", subject: title }}
      footerDocumentId={project.identifier}
    >
      <Header company={company} title={project.name} />
      <ReaderSections sections={sections} />
    </Template>
  );
};

/** The sections, inside `Template` so they read the document theme. */
const ReaderSections = ({ sections }: { sections: ProjectReaderSection[] }) => {
  const tw = useTw();
  return (
    <View style={tw("flex flex-col gap-4 text-xs text-gray-800")}>
      {sections.map((section) => (
        <View key={section.id} style={tw("flex flex-col gap-1")}>
          {/* The heading, property line and facts never split, and they
                move to the next page with the start of the description. */}
          <View
            wrap={false}
            minPresenceAhead={40}
            style={tw("flex flex-col gap-1")}
          >
            <View style={tw("flex flex-row items-baseline gap-2")}>
              <Text
                style={{
                  ...tw("font-bold text-gray-500"),
                  fontSize: headingSize(section.level)
                }}
              >
                {section.number}
              </Text>
              <Text
                style={{
                  ...tw("text-gray-500"),
                  fontSize: headingSize(section.level) - 2
                }}
              >
                {section.readableId}
              </Text>
              <Text
                style={{
                  ...tw("font-bold text-gray-600"),
                  fontSize: headingSize(section.level)
                }}
              >
                {section.name}
              </Text>
            </View>
            {section.properties.length > 0 ? (
              <Text style={tw("text-[8px] text-gray-500")}>
                {section.properties.join("  ·  ")}
              </Text>
            ) : null}
            {section.facts.map((fact) => (
              <View key={fact.label} style={tw("flex flex-row gap-2")}>
                <Text style={tw("text-gray-500")}>{fact.label}</Text>
                <Text>{fact.value}</Text>
              </View>
            ))}
          </View>
          {section.description ? (
            <View style={tw("mt-1")}>
              <Note content={section.description} />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
};

export default ProjectReaderPDF;
