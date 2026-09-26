import { formatDate } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { Header } from "../../components";
import { useTw } from "../tw";
import { FieldCell, NOT_APPLICABLE } from "./Field";
import type { CertificateOfConformanceData } from "./types";

export const CERTIFICATE_TITLE = "CERTIFICATE OF CONFORMITY";
export const CERTIFICATE_SUBTITLE = "(in accordance with IAQG standard 9163)";

/** Company header + fields 1 (Page), 2 (Certificate Number), 3 (Date). */
export function HeaderBlock({ data }: { data: CertificateOfConformanceData }) {
  const tw = useTw();
  const { certificate, locale } = data;

  return (
    <>
      <Header
        company={data.company}
        title={CERTIFICATE_TITLE}
        documentSubId={CERTIFICATE_SUBTITLE}
        locale={locale}
        options={data.headerOptions}
      />
      <View style={tw("border border-gray-200 mb-4 flex flex-row")}>
        <FieldCell
          number={1}
          label="Page"
          style="w-1/3 border-r border-gray-200"
        >
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </FieldCell>
        <FieldCell
          number={2}
          label="Certificate Number"
          style="w-1/3 border-r border-gray-200"
        >
          <Text style={tw("font-bold")}>
            {certificate.number || NOT_APPLICABLE}
          </Text>
        </FieldCell>
        <FieldCell number={3} label="Date" style="w-1/3">
          <Text>
            {certificate.date
              ? formatDate(certificate.date, undefined, locale)
              : NOT_APPLICABLE}
          </Text>
        </FieldCell>
      </View>
    </>
  );
}
