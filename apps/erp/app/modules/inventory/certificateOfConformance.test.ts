import { describe, expect, it } from "vitest";
import type { CertificationLineageRow } from "../quality/certificationLineage";
import type { ConformityDetailsInput } from "./certificateOfConformance";
import {
  buildConformityDetails,
  certificateLineRevision
} from "./certificateOfConformance";

function lineage(
  overrides: Partial<CertificationLineageRow>
): CertificationLineageRow {
  return {
    kind: "Material",
    name: "Aluminium bar 7075-T6",
    specification: null,
    supplierId: null,
    supplierName: null,
    certificateId: "cert-1",
    certificateNumber: "HT-77812",
    documentId: null,
    receiptLineId: "rl-1",
    jobOperationId: null,
    trackedEntityIds: ["te-1"],
    missing: false,
    ...overrides
  };
}

function input(
  overrides: Partial<ConformityDetailsInput> = {}
): ConformityDetailsInput {
  return {
    lots: [],
    fairs: [],
    lineage: [],
    nonconformances: [],
    statements: [],
    reasonForUpdate: null,
    formatDate: (date) => `on ${date}`,
    ...overrides
  };
}

describe("buildConformityDetails", () => {
  it("returns empty groups for empty inputs", () => {
    expect(buildConformityDetails(input())).toEqual({
      shelfLife: [],
      fairs: [],
      materialCertificates: [],
      processCertificates: [],
      concessions: [],
      nonconformances: [],
      statements: [],
      reasonForUpdate: null
    });
  });

  it("de-duplicates statements by id, keeping the first occurrence", () => {
    const result = buildConformityDetails(
      input({
        statements: [
          { id: "cst-1", name: "DFARS", content: "Specialty metals comply." },
          { id: "cst-2", name: "RoHS", content: "RoHS compliant." },
          { id: "cst-1", name: "DFARS", content: "Specialty metals comply." }
        ]
      })
    );
    expect(result.statements).toEqual([
      { name: "DFARS", content: "Specialty metals comply." },
      { name: "RoHS", content: "RoHS compliant." }
    ]);
  });

  it("excludes missing lineage and splits material from process certificates", () => {
    const result = buildConformityDetails(
      input({
        lineage: [
          lineage({
            specification: "AMS 4078",
            supplierName: "Alcoa"
          }),
          lineage({
            kind: "Special Process",
            name: "Anodize",
            certificateId: "cert-2",
            certificateNumber: "AN-100",
            receiptLineId: null,
            jobOperationId: "op-1"
          }),
          lineage({
            name: "Fastener kit",
            certificateId: null,
            certificateNumber: null,
            receiptLineId: "rl-9",
            missing: true
          })
        ]
      })
    );
    expect(result.materialCertificates).toEqual([
      "Aluminium bar 7075-T6 — HT-77812, AMS 4078 (Alcoa)"
    ]);
    expect(result.processCertificates).toEqual(["Anodize — AN-100"]);
  });

  it("prints Use As Is nonconformances as concessions, the rest as nonconformances", () => {
    const result = buildConformityDetails(
      input({
        nonconformances: [
          { nonConformanceId: "NCR000001", disposition: "Use As Is" },
          { nonConformanceId: "NCR000002", disposition: "Rework" },
          { nonConformanceId: "NCR000003", disposition: null },
          { nonConformanceId: "NCR000001", disposition: "Use As Is" }
        ]
      })
    );
    expect(result.concessions).toEqual(["NCR000001: Use As Is"]);
    expect(result.nonconformances).toEqual(["NCR000002: Rework", "NCR000003"]);
  });

  it("prints shelf life only for lots with an expiration date and de-duplicates FAIRs", () => {
    const result = buildConformityDetails(
      input({
        lots: [
          { readableId: "LOT-1", expirationDate: "2027-01-31" },
          { readableId: "LOT-2", expirationDate: null }
        ],
        fairs: [
          { itemReadableId: "GX-4471", fairId: "INS000004" },
          { itemReadableId: "GX-4471", fairId: "INS000004" }
        ],
        reasonForUpdate: "  Corrected lot number  "
      })
    );
    expect(result.shelfLife).toEqual(["LOT-1: expires on 2027-01-31"]);
    expect(result.fairs).toEqual(["GX-4471: INS000004"]);
    expect(result.reasonForUpdate).toBe("Corrected lot number");
  });
});

describe("certificateLineRevision", () => {
  it("prints N/C for an unset item revision, as the FAI does", () => {
    expect(certificateLineRevision(null, "0")).toBe("N/C");
    expect(certificateLineRevision(null, "")).toBe("N/C");
    expect(certificateLineRevision(undefined, null)).toBe("N/C");
  });

  it("prints the item revision when set", () => {
    expect(certificateLineRevision(null, "B")).toBe("B");
  });

  it("prefers the customer part revision when mapped", () => {
    expect(certificateLineRevision("C", "B")).toBe("C");
    expect(certificateLineRevision("C", "0")).toBe("C");
  });
});
