import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { getSafeFontFamily } from "./fonts";

export type FirstArticleInspectionPDFHeader = {
  // Fields 1–4, repeated on every page of every form
  partNumber: string;
  partName: string;
  serialNumber: string | null;
  fairIdentifier: string;
  // Form 1
  partRevision: string | null;
  drawingNumber: string | null;
  drawingRevision: string | null;
  additionalChanges: string | null;
  manufacturingProcessReference: string;
  organizationName: string;
  supplierCode: string | null;
  purchaseOrderNumber: string | null;
  type: "Detail" | "Assembly";
  scope: "Full" | "Partial";
  /** Baseline part number / FAIR for a partial FAI, as printed in field 14. */
  baseline: string | null;
  reason: string;
  hasNonconformance: boolean | null;
  verifiedByName: string | null;
  verifiedByTitle: string | null;
  verifiedDate: string | null;
  approvedByName: string | null;
  approvedByTitle: string | null;
  approvedDate: string | null;
  customerApprovalName: string | null;
  customerApprovalDate: string | null;
  comments: string | null;
};

export type FirstArticleInspectionPDFIndexRow = {
  partNumber: string;
  partName: string;
  partType: string;
  fairIdentifier: string | null;
};

export type FirstArticleInspectionPDFProduct = {
  kind: string;
  name: string;
  specification: string | null;
  code: string | null;
  supplier: string | null;
  customerApprovalVerification: string;
  certificateNumber: string | null;
  functionalTestProcedureNumber: string | null;
  acceptanceReportNumber: string | null;
  comments: string | null;
};

export type FirstArticleInspectionPDFCharacteristic = {
  characteristicNumber: string;
  referenceLocation: string | null;
  designator: string | null;
  requirement: string;
  results: string | null;
  tooling: string | null;
  nonconformanceNumber: string | null;
  comments: string | null;
};

export type FirstArticleInspectionPDFProps = {
  /** False renders a DRAFT mark on every page. */
  approved: boolean;
  header: FirstArticleInspectionPDFHeader;
  index: FirstArticleInspectionPDFIndexRow[];
  products: FirstArticleInspectionPDFProduct[];
  characteristics: FirstArticleInspectionPDFCharacteristic[];
  fontFamily?: string;
};

const BORDER = "#6b7280";
const LABEL_COLOR = "#4b5563";

// Material-condition modifiers are circled letters on a drawing; the PDF's
// fonts have no glyph for them, so the FAIR spells them the way AS9102 forms
// commonly do.
function printable(value: string | null | undefined): string {
  return (value ?? "").replace(/Ⓜ/g, "(M)").replace(/Ⓛ/g, "(L)");
}

function DraftMark() {
  return (
    <View
      fixed
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <Text
        style={{
          fontSize: 140,
          fontWeight: "bold",
          opacity: 0.08,
          transform: "rotate(-30deg)"
        }}
      >
        DRAFT
      </Text>
    </View>
  );
}

/** One boxed AS9102 field: a small numbered label above its value. */
function Field({
  number,
  label,
  value,
  width,
  children
}: {
  number: string;
  label: string;
  value?: string | null;
  width: string;
  children?: ReactNode;
}) {
  return (
    <View
      style={{
        width,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 4,
        paddingVertical: 3,
        minHeight: 26
      }}
    >
      <Text style={{ fontSize: 6.5, color: LABEL_COLOR }}>
        {number}. {label}
      </Text>
      {children ?? (
        <Text style={{ fontSize: 8.5, marginTop: 2 }}>
          {printable(value) || " "}
        </Text>
      )}
    </View>
  );
}

function FieldRow({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        borderLeftWidth: 1,
        borderColor: BORDER
      }}
      wrap={false}
    >
      {children}
    </View>
  );
}

function check(checked: boolean) {
  return checked ? "[X]" : "[  ]";
}

/**
 * Fields 1–4 and the form title, fixed so every continuation page of the form
 * repeats them (AS9102 requires the part identification on each page).
 */
function FormBand({
  title,
  header
}: {
  title: string;
  header: FirstArticleInspectionPDFHeader;
}) {
  return (
    <View fixed style={{ marginBottom: 6 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 4
        }}
      >
        <Text style={{ fontSize: 11, fontWeight: "bold" }}>{title}</Text>
        <Text style={{ fontSize: 7, color: LABEL_COLOR }}>
          AS9102 Rev C — First Article Inspection
        </Text>
      </View>
      <View style={{ borderTopWidth: 1, borderColor: BORDER }}>
        <FieldRow>
          <Field
            number="1"
            label="Part Number"
            value={header.partNumber}
            width="25%"
          />
          <Field
            number="2"
            label="Part Name"
            value={header.partName}
            width="30%"
          />
          <Field
            number="3"
            label="Serial Number"
            value={header.serialNumber}
            width="20%"
          />
          <Field
            number="4"
            label="FAI Report Number"
            value={header.fairIdentifier}
            width="25%"
          />
        </FieldRow>
      </View>
    </View>
  );
}

function PageFooter({ header }: { header: FirstArticleInspectionPDFHeader }) {
  return (
    <View
      fixed
      style={{
        position: "absolute",
        bottom: 14,
        left: 24,
        right: 24,
        flexDirection: "row",
        justifyContent: "space-between",
        borderTopWidth: 0.5,
        borderColor: BORDER,
        paddingTop: 4
      }}
    >
      <Text style={{ fontSize: 7, color: LABEL_COLOR }}>
        {header.organizationName} — {header.fairIdentifier}
      </Text>
      <Text
        style={{ fontSize: 7, color: LABEL_COLOR }}
        render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`
        }
      />
    </View>
  );
}

type Column = { number: string; label: string; width: string };

/**
 * A table header row. Fixed (the default) repeats it on every continuation
 * page — right for a table that fills the page, wrong for one followed by
 * other fields.
 */
function TableHeader({
  columns,
  fixed = true
}: {
  columns: Column[];
  fixed?: boolean;
}) {
  return (
    <View
      fixed={fixed}
      wrap={false}
      style={{
        flexDirection: "row",
        borderLeftWidth: 1,
        borderTopWidth: 1,
        borderColor: BORDER,
        backgroundColor: "#f3f4f6"
      }}
    >
      {columns.map((column) => (
        <View
          key={column.number}
          style={{
            width: column.width,
            borderRightWidth: 1,
            borderBottomWidth: 1,
            borderColor: BORDER,
            paddingHorizontal: 3,
            paddingVertical: 3
          }}
        >
          <Text style={{ fontSize: 6.5, fontWeight: "bold" }}>
            {column.number}. {column.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function TableRow({
  columns,
  values
}: {
  columns: Column[];
  values: (string | null | undefined)[];
}) {
  return (
    <View
      wrap={false}
      style={{
        flexDirection: "row",
        borderLeftWidth: 1,
        borderColor: BORDER
      }}
    >
      {columns.map((column, index) => (
        <View
          key={column.number}
          style={{
            width: column.width,
            borderRightWidth: 1,
            borderBottomWidth: 1,
            borderColor: BORDER,
            paddingHorizontal: 3,
            paddingVertical: 3
          }}
        >
          <Text style={{ fontSize: 7.5 }}>{printable(values[index])}</Text>
        </View>
      ))}
    </View>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <View
      style={{
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderColor: BORDER,
        padding: 6
      }}
    >
      <Text style={{ fontSize: 7.5, color: LABEL_COLOR }}>{text}</Text>
    </View>
  );
}

const INDEX_COLUMNS: Column[] = [
  { number: "15", label: "Part Number", width: "30%" },
  { number: "16", label: "Part Name", width: "35%" },
  { number: "17", label: "Part Type", width: "15%" },
  { number: "18", label: "FAI Report Number", width: "20%" }
];

const PRODUCT_COLUMNS: Column[] = [
  { number: "5", label: "Material or Process Name", width: "16%" },
  { number: "6", label: "Specification Number", width: "12%" },
  { number: "7", label: "Code", width: "7%" },
  { number: "8", label: "Special Process Supplier Code", width: "12%" },
  { number: "9", label: "Customer Approval Verification", width: "9%" },
  { number: "10", label: "Certificate of Conformance Number", width: "12%" },
  { number: "11", label: "Functional Test Procedure Number", width: "10%" },
  { number: "12", label: "Acceptance Report Number", width: "9%" },
  { number: "13", label: "Comments", width: "13%" }
];

const CHARACTERISTIC_COLUMNS: Column[] = [
  { number: "5", label: "Char. No.", width: "6%" },
  { number: "6", label: "Reference Location", width: "9%" },
  { number: "7", label: "Characteristic Designator", width: "8%" },
  { number: "8", label: "Requirement", width: "20%" },
  { number: "9", label: "Results", width: "22%" },
  { number: "10", label: "Designed / Qualified Tooling", width: "12%" },
  { number: "11", label: "Nonconformance Number", width: "10%" },
  { number: "12", label: "Additional Data / Comments", width: "13%" }
];

function signature(name: string | null, title: string | null): string | null {
  if (!name) return null;
  return title ? `${name}, ${title}` : name;
}

function Form1({
  header,
  index
}: Pick<FirstArticleInspectionPDFProps, "header" | "index">) {
  const partial = header.scope === "Partial";
  return (
    <>
      <View style={{ borderTopWidth: 1, borderColor: BORDER }}>
        <FieldRow>
          <Field
            number="5"
            label="Part Revision Level"
            value={header.partRevision}
            width="20%"
          />
          <Field
            number="6"
            label="Drawing Number"
            value={header.drawingNumber}
            width="25%"
          />
          <Field
            number="7"
            label="Drawing Revision Level"
            value={header.drawingRevision}
            width="20%"
          />
          <Field
            number="8"
            label="Additional Changes"
            value={header.additionalChanges}
            width="35%"
          />
        </FieldRow>
        <FieldRow>
          <Field
            number="9"
            label="Manufacturing Process Reference"
            value={header.manufacturingProcessReference}
            width="30%"
          />
          <Field
            number="10"
            label="Organization Name"
            value={header.organizationName}
            width="30%"
          />
          <Field
            number="11"
            label="Supplier Code"
            value={header.supplierCode}
            width="20%"
          />
          <Field
            number="12"
            label="P.O. Number"
            value={header.purchaseOrderNumber}
            width="20%"
          />
        </FieldRow>
        <FieldRow>
          <Field number="13" label="Detail / Assembly FAI" width="30%">
            <Text style={{ fontSize: 8.5, marginTop: 2 }}>
              {check(header.type === "Detail")} Detail FAI{"    "}
              {check(header.type === "Assembly")} Assembly FAI
            </Text>
          </Field>
          <Field number="14" label="Full / Partial FAI" width="70%">
            <Text style={{ fontSize: 8.5, marginTop: 2 }}>
              {check(!partial)} Full FAI{"    "}
              {check(partial)} Partial FAI
              {partial && header.baseline
                ? `    Baseline Part Number including revision level: ${printable(header.baseline)}`
                : ""}
            </Text>
            <Text style={{ fontSize: 8.5, marginTop: 2 }}>
              Reason for Full/Partial FAI: {printable(header.reason)}
            </Text>
          </Field>
        </FieldRow>
      </View>

      <Text
        style={{
          fontSize: 7,
          color: LABEL_COLOR,
          marginTop: 8,
          marginBottom: 3
        }}
      >
        Index of part numbers or sub-assembly numbers required to make the
        assembly noted above.
      </Text>
      <TableHeader columns={INDEX_COLUMNS} fixed={false} />
      {index.length === 0 ? (
        <EmptyRow text="None — detail part." />
      ) : (
        index.map((row, position) => (
          <TableRow
            key={`${row.partNumber}-${position}`}
            columns={INDEX_COLUMNS}
            values={[
              row.partNumber,
              row.partName,
              row.partType,
              row.fairIdentifier
            ]}
          />
        ))
      )}

      <View
        style={{ borderTopWidth: 1, borderColor: BORDER, marginTop: 8 }}
        wrap={false}
      >
        <FieldRow>
          <Field
            number="19"
            label="Does FAIR contain a documented nonconformance(s)?"
            width="100%"
          >
            <Text style={{ fontSize: 8.5, marginTop: 2 }}>
              {check(header.hasNonconformance === true)} Yes{"    "}
              {check(header.hasNonconformance === false)} No
            </Text>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field
            number="20"
            label="FAI Complete Signature"
            value={signature(header.verifiedByName, header.verifiedByTitle)}
            width="70%"
          />
          <Field
            number="21"
            label="Date"
            value={header.verifiedDate}
            width="30%"
          />
        </FieldRow>
        <FieldRow>
          <Field
            number="22"
            label="Reviewed By"
            value={signature(header.approvedByName, header.approvedByTitle)}
            width="70%"
          />
          <Field
            number="23"
            label="Date"
            value={header.approvedDate}
            width="30%"
          />
        </FieldRow>
        <FieldRow>
          <Field
            number="24"
            label="Customer Approval"
            value={header.customerApprovalName}
            width="70%"
          />
          <Field
            number="25"
            label="Date"
            value={header.customerApprovalDate}
            width="30%"
          />
        </FieldRow>
        <FieldRow>
          <Field
            number="26"
            label="Comments"
            value={header.comments}
            width="100%"
          />
        </FieldRow>
      </View>
    </>
  );
}

/**
 * AS9102 Rev C First Article Inspection Report — Forms 1, 2 and 3, each on its
 * own landscape page(s) with fields 1–4 repeated on every page. Fixed layout
 * (no template engine): the FAIR is a regulated record whose field numbering
 * is the contract.
 */
const FirstArticleInspectionPDF = ({
  approved,
  header,
  index,
  products,
  characteristics,
  fontFamily = "Inter"
}: FirstArticleInspectionPDFProps) => {
  const pageStyle = {
    fontFamily: getSafeFontFamily(fontFamily),
    paddingTop: 20,
    paddingHorizontal: 24,
    paddingBottom: 40,
    lineHeight: 1.3,
    color: "#111827"
  };

  return (
    <Document
      title={`${header.fairIdentifier} — First Article Inspection Report`}
      author="Carbon"
      subject={
        approved
          ? "First Article Inspection Report"
          : "First Article Inspection Report (DRAFT - NOT APPROVED)"
      }
      keywords={
        approved
          ? "first article inspection, AS9102"
          : "first article inspection, AS9102, DRAFT"
      }
    >
      <Page size="A4" orientation="landscape" style={pageStyle}>
        {!approved && <DraftMark />}
        <FormBand title="Form 1: Part Number Accountability" header={header} />
        <Form1 header={header} index={index} />
        <PageFooter header={header} />
      </Page>

      <Page size="A4" orientation="landscape" style={pageStyle}>
        {!approved && <DraftMark />}
        <FormBand
          title="Form 2: Product Accountability — Raw Material, Specifications and Special Process(es), Functional Testing"
          header={header}
        />
        <TableHeader columns={PRODUCT_COLUMNS} />
        {products.length === 0 ? (
          <EmptyRow text="No materials, special processes or functional tests recorded." />
        ) : (
          products.map((product, position) => (
            <TableRow
              key={`${product.name}-${position}`}
              columns={PRODUCT_COLUMNS}
              values={[
                `${product.name} (${product.kind})`,
                product.specification,
                product.code,
                product.supplier,
                product.customerApprovalVerification,
                product.certificateNumber,
                product.functionalTestProcedureNumber,
                product.acceptanceReportNumber,
                product.comments
              ]}
            />
          ))
        )}
        <PageFooter header={header} />
      </Page>

      <Page size="A4" orientation="landscape" style={pageStyle}>
        {!approved && <DraftMark />}
        <FormBand
          title="Form 3: Characteristic Accountability, Verification and Compatibility Evaluation"
          header={header}
        />
        <TableHeader columns={CHARACTERISTIC_COLUMNS} />
        {characteristics.length === 0 ? (
          <EmptyRow text="No characteristics on the inspection plan." />
        ) : (
          characteristics.map((row, position) => (
            <TableRow
              key={`${row.characteristicNumber}-${position}`}
              columns={CHARACTERISTIC_COLUMNS}
              values={[
                row.characteristicNumber,
                row.referenceLocation,
                row.designator,
                row.requirement,
                row.results,
                row.tooling,
                row.nonconformanceNumber,
                row.comments
              ]}
            />
          ))
        )}
        <PageFooter header={header} />
      </Page>
    </Document>
  );
};

export default FirstArticleInspectionPDF;
