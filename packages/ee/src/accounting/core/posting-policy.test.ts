// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { asCarbonOwnedSettings } from "../../sync/delegation";
import {
  JOURNAL_ENTRY_SOURCE_TYPES,
  POSTING_POLICY,
  POSTING_SYNC_DEFAULT_SOURCE_TYPES,
  POSTING_SYNC_EXCLUDED_SOURCE_TYPES
} from "./models";
import {
  getJournalPostingPolicyDecision,
  resolvePostingSyncSettings
} from "./posting";

// The settings are marked carbon-owned: delegation has its own tests in
// sync/delegation.test.ts.
const settingsWith = (fragment?: Record<string, unknown>) =>
  asCarbonOwnedSettings(
    resolvePostingSyncSettings({
      settings: { postingSync: { enabled: true, ...fragment } }
    })
  );

type DecisionInput = Parameters<typeof getJournalPostingPolicyDecision>[0];

const DOC_SYNC_ON = { invoiceEnabled: true, billEnabled: true };
const DOC_SYNC_OFF = { invoiceEnabled: false, billEnabled: false };
const AR_JOURNALS = { families: { ar: "journals", ap: "documents" } };
const BILLS_ONLY = { invoiceEnabled: false, billEnabled: true };
const CHARGE_SYNC = { ...DOC_SYNC_ON, chargeEnabled: true };

const decide = ({
  fragment,
  ...input
}: Partial<Omit<DecisionInput, "settings">> & {
  fragment?: Record<string, unknown>;
}) =>
  getJournalPostingPolicyDecision({
    sourceType: "Purchase Receipt",
    docSync: DOC_SYNC_ON,
    ...input,
    settings: settingsWith(fragment)
  });

const PUSH = { kind: "push", granularity: "individual" };
const docBacked = (entityType?: string) => ({
  kind: "exclude",
  reason: "DOC_BACKED",
  ...(entityType ? { backingDocument: { entityType } } : {})
});
const excluded = (reason: string) => ({ kind: "exclude", reason });
const warns = (code: string) => ({ kind: "warn", code });

describe("POSTING_POLICY", () => {
  it("gives every document-represented type a family and a backing entity, and no journal type a family", () => {
    for (const sourceType of JOURNAL_ENTRY_SOURCE_TYPES) {
      const entry = POSTING_POLICY[sourceType];
      if (entry.representation === "document") {
        expect(entry.family, sourceType).toBeDefined();
        expect(entry.backingEntityType, sourceType).not.toBeUndefined();
      } else {
        expect(entry.representation, sourceType).toBe("journal");
        expect(entry.family, sourceType).toBeUndefined();
      }
      if (entry.family === "per-line") expect(sourceType).toBe("Payment");
    }
  });

  // Flipping a type's representation changes what reaches the provider.
  it("derives the default (pushed) and excluded (document) source type lists", () => {
    expect([...POSTING_SYNC_DEFAULT_SOURCE_TYPES].sort()).toEqual(
      [
        "Purchase Receipt",
        "Sales Shipment",
        "Transfer Receipt",
        "Inventory Adjustment",
        "Production Order",
        "Production Event",
        "Job Consumption",
        "Job Receipt",
        "Job Close",
        "Asset Depreciation",
        "Asset Disposal",
        "Non-Conformance",
        "Inbound Inspection",
        "Charge",
        "Maintenance Event"
      ].sort()
    );
    expect([...POSTING_SYNC_EXCLUDED_SOURCE_TYPES].sort()).toEqual(
      [
        "Sales Invoice",
        "Purchase Invoice",
        "Payment",
        "Credit Memo",
        "Debit Memo",
        "Sales Return",
        "Purchase Return",
        "Reimbursement"
      ].sort()
    );
  });
});

describe("getJournalPostingPolicyDecision", () => {
  it.each<[string, Parameters<typeof decide>[0], object]>([
    // Journal-represented types
    ["pushes a journal type individually by default", {}, PUSH],
    [
      "pushes Production Event individually (summary is opt-in)",
      { sourceType: "Production Event" },
      PUSH
    ],
    [
      "pushes an automated type even when a stored enabled:false says otherwise",
      {
        fragment: {
          sourceTypes: {
            "Purchase Receipt": { enabled: false, granularity: "individual" }
          }
        }
      },
      PUSH
    ],
    [
      "permanently excludes Manual",
      { sourceType: "Manual" },
      excluded("MANUAL_DISABLED")
    ],
    [
      "excludes an unknown source type",
      { sourceType: "Not A Source Type" },
      excluded("SOURCE_TYPE_DISABLED")
    ],
    [
      "excludes a missing source type",
      { sourceType: null },
      excluded("SOURCE_TYPE_DISABLED")
    ],
    [
      "hands Inventory Adjustment to the entity syncer when that sync is on",
      {
        sourceType: "Inventory Adjustment",
        inventoryAdjustmentEntitySyncEnabled: true
      },
      docBacked("inventoryAdjustment")
    ],

    // Charge journals are backed per row
    [
      "hands a supplier Charge to the charge syncer",
      {
        sourceType: "Charge",
        docSync: CHARGE_SYNC,
        charge: { type: "Charge", hasSupplier: true }
      },
      docBacked("charge")
    ],
    ...(["Payment", "Cashback", "Repayment"] as const).map(
      (type): [string, Parameters<typeof decide>[0], object] => [
        `keeps pushing a statement ${type} as a journal`,
        {
          sourceType: "Charge",
          docSync: CHARGE_SYNC,
          charge: { type, hasSupplier: true }
        },
        PUSH
      ]
    ),
    [
      "keeps pushing a Charge with no merchant supplier",
      {
        sourceType: "Charge",
        docSync: CHARGE_SYNC,
        charge: { type: "Charge", hasSupplier: false }
      },
      PUSH
    ],
    [
      "keeps pushing a Credit when the provider cannot represent a refund",
      {
        sourceType: "Charge",
        docSync: CHARGE_SYNC,
        charge: { type: "Credit", hasSupplier: true }
      },
      PUSH
    ],
    [
      "backs a Credit when the provider can represent a refund",
      {
        sourceType: "Charge",
        docSync: { ...CHARGE_SYNC, chargeCreditEnabled: true },
        charge: { type: "Credit", hasSupplier: true }
      },
      docBacked("charge")
    ],
    [
      "pushes a Charge when charge sync is off",
      { sourceType: "Charge", charge: { type: "Charge", hasSupplier: true } },
      PUSH
    ],
    [
      "pushes a Charge whose row is unknown",
      { sourceType: "Charge", docSync: CHARGE_SYNC, charge: null },
      PUSH
    ],

    // documents mode (the default for ar/ap)
    [
      "leaves a Sales Invoice to the invoice syncer",
      { sourceType: "Sales Invoice" },
      docBacked("invoice")
    ],
    [
      "warns when a documents-mode family's document sync is off",
      { sourceType: "Purchase Invoice", docSync: DOC_SYNC_OFF },
      warns("DOC_SYNC_DISABLED")
    ],
    [
      "warns for Sales Return, which has no document yet",
      { sourceType: "Sales Return" },
      warns("DOC_SYNC_DISABLED")
    ],
    [
      "warns for Purchase Return, which has no document yet",
      { sourceType: "Purchase Return" },
      warns("DOC_SYNC_DISABLED")
    ],
    [
      "leaves Payment to the payment syncer whatever the document flags",
      { sourceType: "Payment", docSync: DOC_SYNC_OFF, paymentFamily: "ar" },
      docBacked("payment")
    ],
    [
      "excludes a customer memo by default (memo families are opt-in)",
      { sourceType: "Credit Memo", memoParty: "customer" },
      excluded("FAMILY_OFF")
    ],
    [
      "excludes a supplier memo by default",
      { sourceType: "Debit Memo", memoParty: "supplier" },
      excluded("FAMILY_OFF")
    ],
    // An instance on old code can still write the pre-rename key mid-deploy.
    [
      "reads a stored families.vendorCredit as supplierCredit",
      {
        sourceType: "Debit Memo",
        memoParty: "supplier",
        fragment: { families: { vendorCredit: "documents" } },
        docSync: { ...DOC_SYNC_ON, supplierCreditEnabled: true }
      },
      docBacked()
    ],
    [
      "prefers supplierCredit when both keys are stored",
      {
        sourceType: "Debit Memo",
        memoParty: "supplier",
        fragment: {
          families: { vendorCredit: "documents", supplierCredit: "none" }
        }
      },
      excluded("FAMILY_OFF")
    ],

    // journals mode
    [
      "pushes a journals-mode family individually",
      {
        sourceType: "Sales Invoice",
        fragment: AR_JOURNALS,
        docSync: BILLS_ONLY
      },
      PUSH
    ],
    [
      "pushes a memo on its own journals-mode family",
      {
        sourceType: "Credit Memo",
        memoParty: "customer",
        fragment: {
          families: {
            ar: "journals",
            ap: "documents",
            creditMemo: "journals",
            supplierCredit: "none"
          }
        },
        docSync: BILLS_ONLY
      },
      PUSH
    ],
    [
      "warns when a journals-mode family's document sync is also on",
      { sourceType: "Sales Invoice", fragment: AR_JOURNALS },
      warns("DOUBLE_REPRESENTATION")
    ],
    [
      "leaves the other family in documents mode",
      {
        sourceType: "Purchase Invoice",
        fragment: AR_JOURNALS,
        docSync: BILLS_ONLY
      },
      docBacked("bill")
    ],

    // none mode
    [
      "excludes a family set to none",
      {
        sourceType: "Sales Invoice",
        fragment: { families: { ar: "none", ap: "documents" } }
      },
      excluded("FAMILY_OFF")
    ],

    // Payment resolves its family per line
    [
      "follows the AR side of a payment when the families diverge",
      {
        sourceType: "Payment",
        fragment: AR_JOURNALS,
        docSync: BILLS_ONLY,
        paymentFamily: "ar"
      },
      PUSH
    ],
    [
      "follows the AP side of a payment when the families diverge",
      {
        sourceType: "Payment",
        fragment: AR_JOURNALS,
        docSync: BILLS_ONLY,
        paymentFamily: "ap"
      },
      docBacked()
    ],
    [
      "warns when a payment's side is unknown and the families diverge",
      {
        sourceType: "Payment",
        fragment: AR_JOURNALS,
        docSync: BILLS_ONLY,
        paymentFamily: null
      },
      warns("PAYMENT_FAMILY_UNRESOLVED")
    ],
    [
      "needs no payment side when both families share a mode",
      { sourceType: "Payment", paymentFamily: null },
      docBacked()
    ]
  ])("%s", (_name, input, expected) => {
    expect(decide(input)).toMatchObject(expected);
  });
});

// The stored per-type list is a parse-compatible v2 field the decision no
// longer reads: it can neither disable an automated type nor enable a
// document-represented one, nor Manual.
describe("stored source-type overrides", () => {
  it.each([...POSTING_SYNC_DEFAULT_SOURCE_TYPES])(
    "pushes %s even when a narrowed stored list omits it",
    (sourceType) => {
      expect(
        decide({ sourceType, fragment: { sourceTypes: ["Manual"] } }).kind
      ).toBe("push");
    }
  );

  it.each([...POSTING_SYNC_EXCLUDED_SOURCE_TYPES, "Manual"])(
    "never pushes %s, even when the stored list names it",
    (sourceType) => {
      expect(
        decide({
          sourceType,
          fragment: { sourceTypes: [sourceType], includeManual: true }
        }).kind
      ).not.toBe("push");
    }
  );
});

// The memo's PARTY picks its family, never the memo's direction: a supplier
// Credit Memo is AP, a customer Debit Memo is AR.
describe("memo family resolution", () => {
  const MEMO_DOC_SYNC = {
    invoiceEnabled: false,
    billEnabled: false,
    creditMemoEnabled: true,
    supplierCreditEnabled: true
  };
  const families = (creditMemo: string, supplierCredit: string) => ({
    families: { ar: "none", ap: "none", creditMemo, supplierCredit }
  });
  // ap is "none" in both: bills handed to a spend tool must not suppress
  // supplier credits.
  const customerOnly = families("documents", "none");
  const supplierOnly = families("none", "documents");

  it.each([
    [
      "Credit Memo",
      "customer",
      "customer family on",
      customerOnly,
      docBacked()
    ],
    ["Debit Memo", "customer", "customer family on", customerOnly, docBacked()],
    ["Debit Memo", "supplier", "supplier family on", supplierOnly, docBacked()],
    [
      "Credit Memo",
      "supplier",
      "supplier family on",
      supplierOnly,
      docBacked()
    ],
    [
      "Credit Memo",
      "supplier",
      "customer family on",
      customerOnly,
      excluded("FAMILY_OFF")
    ],
    [
      "Debit Memo",
      "customer",
      "supplier family on",
      supplierOnly,
      excluded("FAMILY_OFF")
    ],
    [
      "Credit Memo",
      null,
      "customer family on",
      customerOnly,
      warns("MEMO_PARTY_UNRESOLVED")
    ]
  ] as const)(
    "decides a %s from a %s party with the %s",
    (sourceType, memoParty, _families, fragment, expected) => {
      expect(
        decide({ sourceType, memoParty, fragment, docSync: MEMO_DOC_SYNC })
      ).toMatchObject(expected);
    }
  );
});
