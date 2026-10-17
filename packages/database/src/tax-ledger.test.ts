// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { SCALE } from "./precision.ts";
import { splitLineTax, type TaxComponentInput } from "./tax-components.ts";
import {
  type BuildTaxLedgerRowsInput,
  buildTaxLedgerRows,
  negateTaxLedgerRows
} from "./tax-ledger.ts";

function component(
  overrides: Partial<TaxComponentInput> = {}
): TaxComponentInput {
  return {
    id: "state",
    name: "TX State",
    taxAuthorityId: "comptroller",
    taxPercent: 0.0625,
    recoverablePercent: 0,
    sequence: 1,
    isCompound: false,
    taxReceivedAccountId: null,
    taxPaidAccountId: null,
    effectiveDate: null,
    expirationDate: null,
    ...overrides
  };
}

const base: Omit<BuildTaxLedgerRowsInput, "lines"> = {
  companyId: "co",
  createdBy: "user",
  source: "Sales",
  documentType: "Sales Invoice",
  documentId: "inv",
  journalId: "jrn",
  postingDate: "2026-10-16",
  customerId: "cust",
  currencyCode: "USD",
  exchangeRate: 1,
  currencyDecimals: 2,
  sign: 1
};

describe("buildTaxLedgerRows", () => {
  it("writes one row per component with the authority and base", () => {
    const components = [
      component(),
      component({
        id: "city",
        name: "City of Austin",
        taxAuthorityId: "austin",
        taxPercent: 0.02,
        sequence: 2
      })
    ];
    const rows = buildTaxLedgerRows({
      ...base,
      lines: [
        {
          documentLineId: "line",
          taxCodeId: "austin-code",
          taxableBase: 1000,
          components: splitLineTax({
            base: 1000,
            lineTax: 82.5,
            components,
            scale: SCALE
          }),
          taxPercent: 0.0825,
          taxAmount: 82.5,
          exempt: null
        }
      ]
    });
    expect(
      rows.map((r) => [
        r.componentName,
        r.taxAuthorityId,
        r.taxableAmount,
        r.taxAmount
      ])
    ).toEqual([
      ["TX State", "comptroller", 1000, 62.5],
      ["City of Austin", "austin", 1000, 20]
    ]);
  });

  it("writes one row for a legacy line with only a rate", () => {
    const rows = buildTaxLedgerRows({
      ...base,
      lines: [
        {
          documentLineId: "line",
          taxCodeId: null,
          taxableBase: 100,
          components: [],
          taxPercent: 0.08,
          taxAmount: 8,
          exempt: null
        }
      ]
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taxCodeId: null,
      taxPercent: 0.08,
      taxAmount: 8,
      taxableAmount: 100,
      exemptAmount: 0
    });
  });

  it("records an exempt line's base as exempt with its reason", () => {
    const [row] = buildTaxLedgerRows({
      ...base,
      lines: [
        {
          documentLineId: "line",
          taxCodeId: null,
          taxableBase: 500,
          components: [],
          taxPercent: 0,
          taxAmount: 0,
          exempt: { reason: "Resale", certificateNumber: "CERT-1" }
        }
      ]
    });
    expect(row).toMatchObject({
      exemptAmount: 500,
      taxableAmount: 0,
      taxAmount: 0,
      taxExemptionReason: "Resale",
      exemptionCertificateNumber: "CERT-1"
    });
  });

  it("converts a foreign document into its own currency", () => {
    const [row] = buildTaxLedgerRows({
      ...base,
      currencyCode: "EUR",
      exchangeRate: 0.92,
      lines: [
        {
          documentLineId: "line",
          taxCodeId: null,
          taxableBase: 100,
          components: [],
          taxPercent: 0.2,
          taxAmount: 20,
          exempt: null
        }
      ]
    });
    expect(row).toMatchObject({
      taxAmount: 20,
      documentTaxAmount: 18.4,
      documentTaxableAmount: 92
    });
  });

  it("records the recoverable share of purchase tax", () => {
    const [row] = buildTaxLedgerRows({
      ...base,
      source: "Purchase",
      documentType: "Purchase Invoice",
      customerId: null,
      supplierId: "supp",
      lines: [
        {
          documentLineId: "line",
          taxCodeId: "car-lease",
          taxableBase: 1000,
          components: splitLineTax({
            base: 1000,
            lineTax: 200,
            components: [
              component({ taxPercent: 0.2, recoverablePercent: 0.5 })
            ],
            scale: SCALE
          }),
          taxPercent: 0.2,
          taxAmount: 200,
          exempt: null
        }
      ]
    });
    expect(row).toMatchObject({
      taxAmount: 200,
      recoverableAmount: 100,
      recoverablePercent: 0.5,
      supplierId: "supp"
    });
  });

  it("negates every amount for a void", () => {
    const rows = buildTaxLedgerRows({
      ...base,
      lines: [
        {
          documentLineId: "line",
          taxCodeId: null,
          taxableBase: 100,
          components: [],
          taxPercent: 0.1,
          taxAmount: 10,
          exempt: null
        }
      ]
    });
    const [voided] = negateTaxLedgerRows(rows, {
      journalId: "void-jrn",
      postingDate: "2026-10-17",
      createdBy: "user"
    });
    expect(voided).toMatchObject({
      journalId: "void-jrn",
      taxAmount: -10,
      taxableAmount: -100,
      documentTaxAmount: -10
    });
  });
});
