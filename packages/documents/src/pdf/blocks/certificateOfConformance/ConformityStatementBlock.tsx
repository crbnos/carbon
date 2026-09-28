import { formatDate } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { useTw } from "../tw";
import { FieldLabel } from "./Field";
import type { CertificateOfConformanceData } from "./types";

/** The fixed AS9163 §4.2 statement of conformity, verbatim. */
export const CONFORMITY_STATEMENT =
  'It is hereby certified that apart from the deviations, concessions, or waivers noted in "Conformity Details", the product(s) / service(s) detailed above has (have) been manufactured / maintained / reworked / performed / inspected / tested and conform to applicable specifications, drawings, and purchase order and contract requirements.';

export const ELECTRONIC_VALIDATION =
  "Document electronically generated and validated.";

export const NOT_ISSUED_LABEL = "PREVIEW — NOT ISSUED";

/** Field 14 — statement + signer (or the not-issued marker on a preview). */
export function ConformityStatementBlock({
  data
}: {
  data: CertificateOfConformanceData;
}) {
  const tw = useTw();
  const { certificate, locale } = data;
  const signer = certificate.signer;

  return (
    <View style={tw("border border-gray-200 mb-4 p-3")} wrap={false}>
      <FieldLabel number={14} label="Statement of Conformity" />
      <Text style={tw("text-[9px] text-gray-800 mb-2")}>
        {CONFORMITY_STATEMENT}
      </Text>
      <Text style={tw("text-[9px] text-gray-800 mb-2")}>
        {ELECTRONIC_VALIDATION}
      </Text>
      {certificate.issued && signer ? (
        <View style={tw("flex flex-row text-[9px] text-gray-800")}>
          <View style={tw("w-1/3 pr-2")}>
            <Text style={tw("text-[8px] font-bold text-gray-600 uppercase")}>
              Name
            </Text>
            <Text>{signer.name}</Text>
          </View>
          <View style={tw("w-1/3 pr-2")}>
            <Text style={tw("text-[8px] font-bold text-gray-600 uppercase")}>
              Title
            </Text>
            <Text>{signer.title || "N/A"}</Text>
          </View>
          <View style={tw("w-1/3")}>
            <Text style={tw("text-[8px] font-bold text-gray-600 uppercase")}>
              Date
            </Text>
            <Text>
              {certificate.date
                ? formatDate(certificate.date, undefined, locale)
                : "N/A"}
            </Text>
          </View>
        </View>
      ) : (
        <Text style={tw("text-[10px] font-bold text-gray-800")}>
          {NOT_ISSUED_LABEL}
        </Text>
      )}
    </View>
  );
}
