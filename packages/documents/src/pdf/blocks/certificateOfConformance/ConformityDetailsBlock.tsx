import { Text, View } from "@react-pdf/renderer";
import { useTw } from "../tw";
import { FieldLabel, NONE } from "./Field";
import type { CertificateOfConformanceData } from "./types";

function Group({ title, entries }: { title: string; entries: string[] }) {
  const tw = useTw();
  return (
    <View style={tw("flex flex-row mb-1")} wrap={false}>
      <Text style={tw("w-1/3 pr-2 text-[9px] font-bold text-gray-600")}>
        {title}
      </Text>
      <View style={tw("w-2/3 text-[9px] text-gray-800")}>
        {entries.length === 0 ? (
          <Text>{NONE}</Text>
        ) : (
          entries.map((entry, index) => <Text key={index}>{entry}</Text>)
        )}
      </View>
    </View>
  );
}

/** Field 13 — every group printed, "None" when it has nothing to report. */
export function ConformityDetailsBlock({
  data
}: {
  data: CertificateOfConformanceData;
}) {
  const tw = useTw();
  const { conformity, certificate } = data;
  const reasonForUpdate =
    conformity.reasonForUpdate ?? certificate.reasonForUpdate;

  return (
    <View style={tw("border border-gray-200 mb-4 p-3")}>
      <FieldLabel number={13} label="Conformity Details" />
      <Group title="Shelf Life" entries={conformity.shelfLife} />
      <Group title="First Article Inspection" entries={conformity.fairs} />
      <Group
        title="Material Certificates"
        entries={conformity.materialCertificates}
      />
      <Group
        title="Process Certificates"
        entries={conformity.processCertificates}
      />
      <Group
        title="Deviations, Concessions and Waivers"
        entries={conformity.concessions}
      />
      <Group title="Nonconformances" entries={conformity.nonconformances} />
      <Group
        title="Compliance Statements"
        entries={conformity.statements.map((statement) =>
          statement.name
            ? `${statement.name}: ${statement.content}`
            : statement.content
        )}
      />
      <Group
        title="Reason for Update"
        entries={reasonForUpdate ? [reasonForUpdate] : []}
      />
    </View>
  );
}
