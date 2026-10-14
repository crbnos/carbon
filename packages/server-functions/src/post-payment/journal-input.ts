// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The input of a payment's journal: the party, the control account, the
// control lines of its targets and funding sources, the stand-in role of each
// line and the party dimensions. `postPaymentTransaction` (the posting) and
// `rebuildPaymentJournals` (the void of a payment dated before the cutover,
// and the enable's legacy payments) both assemble the `buildPaymentJournal`
// input here, so a rebuilt journal is the journal the posting wrote.

import { OPEN_ITEM_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import type { KyselyDatabase } from "@carbon/database/client";
import {
  type AutomaticJournalStatus,
  type OptionalDefaultRole,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import {
  type BuildPaymentJournalInput,
  buildPaymentJournal,
  type PaymentJournalFeeInput,
  type PaymentJournalLine
} from "@carbon/database/posting";
import {
  CUSTOMER_DEPOSIT_APPLIED_DESCRIPTION,
  CUSTOMER_DEPOSIT_DESCRIPTION,
  onAccountCreditDescription,
  PAYABLE_POSTING_DESCRIPTIONS,
  RECEIVABLE_POSTING_DESCRIPTIONS,
  REIMBURSEMENT_PAYABLE_POSTING_DESCRIPTION,
  round
} from "@carbon/utils";
import { type Selectable, sql, type Transaction } from "kysely";
import { NotFoundError } from "../errors";
import { partyDimensionValuesFrom } from "../lib/party-dimensions";

type Trx = Transaction<KyselyDatabase>;
export type PaymentRow = Selectable<KyselyDatabase["payment"]>;
type AccountDefaults = Selectable<KyselyDatabase["accountDefault"]>;

/** A journal line with the stand-in role the posting gives it. */
export type PaymentJournalLineWithRole = PaymentJournalLine & {
  accountDefaultRole: OptionalDefaultRole | null;
};

/** What decides the shape of a payment's journal, from the stored row. */
export function paymentKind(
  payment: Pick<
    PaymentRow,
    | "customerId"
    | "supplierId"
    | "employeeId"
    | "paymentType"
    | "rentalAgreementId"
    | "salesOrderId"
  >
) {
  // An employee payee is a reimbursement payout: always cash OUT against the
  // employee-payable control account, so it is neither AR nor a refund, has
  // no trade-party row, and has no on-account credit history to draw on.
  const isReimbursement = payment.employeeId !== null;
  const isAR = payment.customerId !== null;
  const partyId = isReimbursement
    ? payment.employeeId
    : isAR
      ? payment.customerId
      : payment.supplierId;
  if (
    !partyId ||
    [payment.customerId, payment.supplierId, payment.employeeId].filter(Boolean)
      .length !== 1
  ) {
    throw new Error(
      "A payment requires exactly one party (customer, supplier, or employee)"
    );
  }
  const cashIn = payment.paymentType === "Receipt";
  const isRefund = !isReimbursement && cashIn !== isAR;
  return {
    isReimbursement,
    isAR,
    cashIn,
    isRefund,
    // A payment that references a sales order or rental agreement is a
    // customer deposit: its unapplied cash is a liability on the prepayment
    // account rather than on-account receivable credit. The builder ignores
    // the flag for supplier payments.
    isDeposit: Boolean(payment.rentalAgreementId ?? payment.salesOrderId),
    partyId,
    targetColumn: isReimbursement
      ? ("targetReimbursementId" as const)
      : isRefund
        ? ("targetMemoId" as const)
        : isAR
          ? ("targetSalesInvoiceId" as const)
          : ("targetPurchaseInvoiceId" as const),
    // A target's control line: its document type, descriptions and source
    // types. A target open at the accounting cutover carries its control line
    // in the opening journal, with the same document keys.
    targetDocumentType: isReimbursement
      ? ("Reimbursement" as const)
      : isRefund
        ? ("Memo" as const)
        : ("Invoice" as const),
    targetDescriptions: (isReimbursement
      ? [REIMBURSEMENT_PAYABLE_POSTING_DESCRIPTION]
      : isAR
        ? RECEIVABLE_POSTING_DESCRIPTIONS
        : PAYABLE_POSTING_DESCRIPTIONS) as readonly string[],
    targetSourceTypes: [
      isReimbursement
        ? "Reimbursement"
        : isRefund
          ? isAR
            ? "Credit Memo"
            : "Debit Memo"
          : isAR
            ? "Sales Invoice"
            : "Purchase Invoice",
      "Opening Balance"
    ] as readonly string[],
    // A source's unapplied cash was booked EITHER as on-account credit or,
    // for a customer deposit, on the prepayment account; the description
    // says which.
    sourceDescriptions: (isAR
      ? [onAccountCreditDescription(true), CUSTOMER_DEPOSIT_DESCRIPTION]
      : [onAccountCreditDescription(false)]) as readonly string[]
  };
}
export type PaymentKind = ReturnType<typeof paymentKind>;

const TARGET_DESCRIPTIONS = [
  ...new Set<string>([
    REIMBURSEMENT_PAYABLE_POSTING_DESCRIPTION,
    ...RECEIVABLE_POSTING_DESCRIPTIONS,
    ...PAYABLE_POSTING_DESCRIPTIONS
  ])
];

/** The control lines of the targets, for every payment kind; filter them
 *  per payment with `foldTargetControls`. */
export function readTargetControlLines(
  trx: Trx,
  companyId: string,
  targetIds: string[]
) {
  if (targetIds.length === 0) return Promise.resolve([]);
  return trx
    .selectFrom("journalLine as line")
    .innerJoin("journal as journal", (join) =>
      join
        .onRef("journal.id", "=", "line.journalId")
        .onRef("journal.companyId", "=", "line.companyId")
    )
    .select([
      "line.documentId",
      "line.documentType",
      "line.description",
      "line.amount",
      "line.accountId",
      "line.accountDefaultRole",
      "journal.sourceType"
    ])
    .where("line.companyId", "=", companyId)
    .where("line.documentType", "in", ["Invoice", "Memo", "Reimbursement"])
    .where(sql<boolean>`"line"."documentId" = any(${targetIds}::text[])`)
    .where("line.description", "in", TARGET_DESCRIPTIONS)
    .where("journal.sourceType", "in", [
      "Reimbursement",
      "Credit Memo",
      "Debit Memo",
      "Sales Invoice",
      "Purchase Invoice",
      "Opening Balance"
    ])
    .where("journal.status", "in", [...OPEN_ITEM_JOURNAL_STATUSES])
    .execute();
}
export type TargetControlLine = Awaited<
  ReturnType<typeof readTargetControlLines>
>[number];

/** Each target's original control account, carrying value and stand-in role. */
export type TargetControls = {
  controlById: Map<string, string>;
  carryingById: Map<string, number>;
  /** Before the cutover a control line may be a stand-in: booked on
   *  retained earnings, naming the default it wanted. */
  roleById: Map<string, OptionalDefaultRole | null>;
};

/** The control lines of `kind`'s targets, folded per target. */
export function foldTargetControls(
  kind: PaymentKind,
  lines: TargetControlLine[]
): TargetControls {
  const controls: TargetControls = {
    controlById: new Map(),
    carryingById: new Map(),
    roleById: new Map()
  };
  for (const line of lines) {
    if (
      !line.documentId ||
      line.documentType !== kind.targetDocumentType ||
      !kind.targetDescriptions.includes(line.description ?? "") ||
      !kind.targetSourceTypes.includes(line.sourceType ?? "")
    ) {
      continue;
    }
    if (!line.accountId) {
      throw new Error("Invoice is missing its original control account");
    }
    const originalAccount = controls.controlById.get(line.documentId);
    if (originalAccount && originalAccount !== line.accountId) {
      throw new Error("Invoice has conflicting original control accounts");
    }
    controls.controlById.set(line.documentId, line.accountId);
    controls.carryingById.set(
      line.documentId,
      round(
        (controls.carryingById.get(line.documentId) ?? 0) + Number(line.amount)
      )
    );
    if (line.accountDefaultRole || !controls.roleById.has(line.documentId)) {
      controls.roleById.set(
        line.documentId,
        (line.accountDefaultRole as OptionalDefaultRole | null) ?? null
      );
    }
  }
  return controls;
}

/** The on-account and deposit lines of the funding sources, for every
 *  payment kind; filter them per payment with `foldSourceControls`. */
export function readSourceControlLines(
  trx: Trx,
  companyId: string,
  sourceIds: string[]
) {
  if (sourceIds.length === 0) return Promise.resolve([]);
  return trx
    .selectFrom("journalLine as line")
    .innerJoin("journal as journal", (join) =>
      join
        .onRef("journal.id", "=", "line.journalId")
        .onRef("journal.companyId", "=", "line.companyId")
    )
    .select([
      "line.documentId",
      "line.accountId",
      "line.description",
      "line.accountDefaultRole"
    ])
    .where("line.companyId", "=", companyId)
    .where("line.documentType", "=", "Payment")
    .where(sql<boolean>`"line"."documentId" = any(${sourceIds}::text[])`)
    .where("line.description", "in", [
      onAccountCreditDescription(true),
      onAccountCreditDescription(false),
      CUSTOMER_DEPOSIT_DESCRIPTION
    ])
    .where("journal.sourceType", "in", ["Payment", "Opening Balance"])
    .where("journal.status", "in", [...OPEN_ITEM_JOURNAL_STATUSES])
    .execute();
}
export type SourceControlLine = {
  documentId: string | null;
  accountId: string | null;
  description: string | null;
  accountDefaultRole: string | null;
};

/** Each funding source's original control account, whether it is a
 *  deposit, and its stand-in role. */
export type SourceControls = {
  accountById: Map<string, string>;
  /** Sources whose credit is a deposit (booked on the prepayment account):
   *  released as a liability under the deposit description. */
  depositIds: Set<string>;
  roleById: Map<string, OptionalDefaultRole | null>;
};

/** The control lines of `kind`'s funding sources, folded per source. */
export function foldSourceControls(
  kind: PaymentKind,
  lines: SourceControlLine[]
): SourceControls {
  const controls: SourceControls = {
    accountById: new Map(),
    depositIds: new Set(),
    roleById: new Map()
  };
  for (const line of lines) {
    if (
      !line.documentId ||
      !kind.sourceDescriptions.includes(line.description ?? "")
    ) {
      continue;
    }
    if (!line.accountId) {
      throw new Error("Funding source is missing its original control account");
    }
    const lineIsDeposit = line.description === CUSTOMER_DEPOSIT_DESCRIPTION;
    const originalAccount = controls.accountById.get(line.documentId);
    if (
      originalAccount &&
      (originalAccount !== line.accountId ||
        controls.depositIds.has(line.documentId) !== lineIsDeposit)
    ) {
      throw new Error(
        "Funding source has conflicting original control accounts"
      );
    }
    controls.accountById.set(line.documentId, line.accountId);
    if (lineIsDeposit) controls.depositIds.add(line.documentId);
    if (line.accountDefaultRole || !controls.roleById.has(line.documentId)) {
      controls.roleById.set(
        line.documentId,
        (line.accountDefaultRole as OptionalDefaultRole | null) ?? null
      );
    }
  }
  return controls;
}

/** A payment's counterparty: its type, for the party dimension, and its
 *  intercompany link. */
export type PaymentParty = {
  typeId: string | null;
  intercompanyCompanyId: string | null;
};

/**
 * The counterparties of the payments, in one read per party table. An
 * employee is neither a customer nor a supplier, so it has no trade party
 * type to tag journal lines with. The lookup throws for a party that is not
 * in the company.
 */
export async function readPaymentParties(
  trx: Trx,
  companyId: string,
  kinds: PaymentKind[]
): Promise<(kind: PaymentKind) => PaymentParty> {
  const ids = (predicate: (kind: PaymentKind) => boolean) => [
    ...new Set(kinds.filter(predicate).map((kind) => kind.partyId))
  ];
  const customerIds = ids((kind) => !kind.isReimbursement && kind.isAR);
  const supplierIds = ids((kind) => !kind.isReimbursement && !kind.isAR);
  const employeeIds = ids((kind) => kind.isReimbursement);
  type PartyRow = PaymentParty & { id: string };
  const none = Promise.resolve([] as PartyRow[]);
  const [customers, suppliers, employees] = await Promise.all([
    customerIds.length
      ? trx
          .selectFrom("customer")
          .select(["id", "customerTypeId as typeId", "intercompanyCompanyId"])
          .where("companyId", "=", companyId)
          .where("id", "in", customerIds)
          .execute()
      : none,
    supplierIds.length
      ? trx
          .selectFrom("supplier")
          .select(["id", "supplierTypeId as typeId", "intercompanyCompanyId"])
          .where("companyId", "=", companyId)
          .where("id", "in", supplierIds)
          .execute()
      : none,
    employeeIds.length
      ? trx
          .selectFrom("employee")
          .select("id")
          .where("companyId", "=", companyId)
          .where("id", "in", employeeIds)
          .execute()
      : Promise.resolve([] as { id: string }[])
  ]);
  const customerById = new Map(customers.map((row) => [row.id, row]));
  const supplierById = new Map(suppliers.map((row) => [row.id, row]));
  const employeeIdSet = new Set(employees.map((row) => row.id));
  return (kind) => {
    const party = kind.isReimbursement
      ? employeeIdSet.has(kind.partyId)
        ? { typeId: null, intercompanyCompanyId: null }
        : undefined
      : (kind.isAR ? customerById : supplierById).get(kind.partyId);
    if (!party) throw new NotFoundError("Payment counterparty not found");
    return {
      typeId: party.typeId,
      intercompanyCompanyId: party.intercompanyCompanyId
    };
  };
}

/** The classes of the payment discount accounts, for the discount line's
 *  natural-balance sign. */
export async function readDiscountAccountClasses(
  trx: Trx,
  companyGroupId: string,
  defaults: AccountDefaults
): Promise<Map<string, string | null>> {
  const ids = [
    ...new Set(
      [
        defaults.customerPaymentDiscountAccount,
        defaults.supplierPaymentDiscountAccount
      ].filter((id): id is string => !!id)
    )
  ];
  if (ids.length === 0) return new Map();
  const rows = await trx
    .selectFrom("account")
    .select(["id", "class"])
    .where("id", "in", ids)
    .where("companyGroupId", "=", companyGroupId)
    .execute();
  return new Map(rows.map((row) => [row.id, row.class]));
}

/**
 * The control account a payment books its new on-account credit to, and a
 * target with no control line. A reimbursement books to the employee
 * payable default and an intercompany party to its intercompany default;
 * each falls back to payables or receivables when empty.
 */
export function paymentControlAccount(
  kind: PaymentKind,
  party: PaymentParty,
  defaults: AccountDefaults,
  postingStatus: AutomaticJournalStatus
): { accountId: string; accountDefaultRole: OptionalDefaultRole | null } {
  if (kind.isReimbursement) {
    return resolveDefaultAccount(
      defaults,
      "employeeReimbursementsPayableAccount",
      postingStatus
    );
  }
  if (party.intercompanyCompanyId) {
    return resolveDefaultAccount(
      defaults,
      kind.isAR
        ? "intercompanyReceivablesAccount"
        : "intercompanyPayablesAccount",
      postingStatus
    );
  }
  return {
    accountId: kind.isAR
      ? defaults.receivablesAccount
      : defaults.payablesAccount,
    accountDefaultRole: null
  };
}

/** One settlement of the payment, as the posting stores it. */
export type PaymentApplication = {
  targetSalesInvoiceId: string | null;
  targetPurchaseInvoiceId: string | null;
  targetMemoId: string | null;
  targetReimbursementId: string | null;
  sourcePaymentId: string | null;
  sourceAmount: number;
  sourceExchangeRate: number;
  targetExchangeRate: number;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  fxGainLossAmount: number;
};

/**
 * Builds the payment's journal from what the posting resolves: the lines,
 * each with its stand-in role, and the applications and accounts the
 * builder took (the posting checks their classes).
 *
 * A line takes a stand-in role from what it books, not from its account, so
 * two empty defaults on one payment keep their own roles even when both
 * stand in on retained earnings:
 * - a target's control line takes the role of the target's control line,
 *   else (a target with no control line) the control account's;
 * - the new on-account credit takes the control account's role;
 * - a released prior credit takes its source's role, else the control
 *   account's.
 */
export function assemblePaymentJournal(args: {
  payment: PaymentRow;
  kind: PaymentKind;
  companyId: string;
  defaults: AccountDefaults;
  control: {
    accountId: string;
    accountDefaultRole: OptionalDefaultRole | null;
  };
  discountClasses: Map<string, string | null>;
  targets: TargetControls;
  sources: SourceControls;
  applications: PaymentApplication[];
  /** The current cash the funding allocation left unapplied, in base. */
  newOnAccountBase: number;
  fee?: PaymentJournalFeeInput;
  journalLineReference: string;
}): {
  lines: PaymentJournalLineWithRole[];
  input: BuildPaymentJournalInput;
} {
  const {
    payment,
    kind,
    companyId,
    defaults,
    control,
    discountClasses,
    targets,
    sources
  } = args;
  const discountAccountId = kind.isAR
    ? defaults.customerPaymentDiscountAccount
    : defaults.supplierPaymentDiscountAccount;
  // The discount account's class signs the discount line by its natural
  // balance (customer discount -> Revenue/contra-revenue; supplier discount
  // -> Expense/contra-COGS).
  if (discountAccountId && !discountClasses.has(discountAccountId)) {
    throw new Error("Failed to fetch the payment discount account class");
  }
  const discountAccountClass = discountAccountId
    ? (discountClasses.get(discountAccountId) ?? null)
    : null;
  const applications = args.applications.map((application) => {
    const target = application[kind.targetColumn];
    const sourceId = application.sourcePaymentId;
    return {
      ...application,
      // Before the cutover a target posted with no journal has no control
      // line: the default control account stands in for it.
      targetControlAccountId:
        (target ? targets.controlById.get(target) : undefined) ??
        control.accountId,
      sourceControlAccountId: sourceId
        ? sources.accountById.get(sourceId)
        : undefined,
      sourceIsDeposit: sourceId ? sources.depositIds.has(sourceId) : undefined
    };
  });
  const input: BuildPaymentJournalInput = {
    paymentId: payment.id,
    companyId,
    isAR: kind.isAR,
    isReimbursement: kind.isReimbursement,
    cashIn: kind.cashIn,
    totalAmount: Number(payment.totalAmount),
    exchangeRate: Number(payment.exchangeRate),
    bankAccount: payment.bankAccount,
    journalLineReference: args.journalLineReference,
    applications,
    newOnAccountBase: args.newOnAccountBase,
    fee: args.fee,
    accounts: {
      // For a reimbursement this drives ONLY the new on-account remainder:
      // every application carries the payable line of the reimbursement's
      // own journal as its `targetControlAccountId`.
      controlAccountId: control.accountId,
      discountAccountId,
      discountAccountClass,
      writeOffAccountId: kind.isAR
        ? defaults.customerWriteOffAccount
        : defaults.supplierWriteOffAccount,
      fxGainAccountId: defaults.realizedExchangeGainAccount,
      fxLossAccountId: defaults.realizedExchangeLossAccount
    },
    isDeposit: kind.isDeposit,
    depositAccountId: defaults.prepaymentAccount
  };

  const controlDescription = kind.isReimbursement
    ? "Employee Reimbursements Payable"
    : kind.isAR
      ? "Accounts Receivable"
      : "Accounts Payable";
  const creditAppliedDescriptions = [
    `${kind.isAR ? "Accounts Receivable" : "Accounts Payable"} (credit applied)`,
    CUSTOMER_DEPOSIT_APPLIED_DESCRIPTION
  ];
  // The builder releases prior credit one line per account.
  const sourceRoleByAccount = new Map<string, OptionalDefaultRole | null>();
  for (const application of applications) {
    const sourceId = application.sourcePaymentId;
    if (!sourceId) continue;
    const accountId = application.sourceControlAccountId ?? control.accountId;
    const role = sources.accountById.has(sourceId)
      ? (sources.roleById.get(sourceId) ?? null)
      : control.accountDefaultRole;
    if (role || !sourceRoleByAccount.has(accountId)) {
      sourceRoleByAccount.set(accountId, role);
    }
  }
  const roleOf = (line: PaymentJournalLine): OptionalDefaultRole | null => {
    if (line.documentLineReference && line.description === controlDescription) {
      const target = line.documentLineReference;
      return targets.controlById.has(target)
        ? (targets.roleById.get(target) ?? null)
        : control.accountDefaultRole;
    }
    if (line.description === onAccountCreditDescription(kind.isAR)) {
      return control.accountDefaultRole;
    }
    if (creditAppliedDescriptions.includes(line.description)) {
      return sourceRoleByAccount.get(line.accountId) ?? null;
    }
    return null;
  };
  return {
    input,
    lines: buildPaymentJournal(input).lines.map((line) => ({
      ...line,
      accountDefaultRole: roleOf(line)
    }))
  };
}

/**
 * The party dimensions every line of the payment's journal carries. A
 * reimbursement payout has no trade party to tag, and the reimbursement's
 * own journal writes no party dimension either.
 */
export function paymentDimensions(
  dimensions: { id: string; entityType: string }[],
  kind: PaymentKind,
  party: PaymentParty
): { dimensionId: string; valueId: string }[] {
  if (kind.isReimbursement) return [];
  return partyDimensionValuesFrom(dimensions, {
    isAR: kind.isAR,
    partyId: kind.partyId,
    typeId: party.typeId
  });
}
