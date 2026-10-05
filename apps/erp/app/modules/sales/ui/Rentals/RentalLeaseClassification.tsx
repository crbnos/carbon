// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  cn,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  VStack
} from "@carbon/react";
import { formatPercent, salesTypeRequirementError } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ReactNode } from "react";
import { LuCircleCheck, LuCircleMinus } from "react-icons/lu";
import { Select, Submit, TextArea } from "~/components/Form";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";
import {
  lessorClassificationOverrides,
  rentalAgreementLineClassificationValidator
} from "../../sales.models";
import type {
  LeaseClassificationRecord,
  LeaseClassificationTests,
  LeasePolicy
} from "../../sales.utils";
import {
  leaseCommencementPreview,
  previewLeaseClassification,
  readLeaseClassification
} from "../../sales.utils";
import RentalMoney from "./RentalMoney";
import type {
  RentalAgreement,
  RentalAgreementLine,
  RentalLeaseLineInputs
} from "./types";

type LeaseClassificationValue = "Rental" | "Sale";

/** The accounting treatment's name on screen. The stored values are the
 *  labels themselves; `useLeaseStandardTerm` gives the ASC 842 / IFRS 16
 *  name an accountant knows each one by. */
export function useLeaseClassificationLabel() {
  const { t } = useLingui();
  return (value: string) => {
    switch (value) {
      case "Sale":
        return t`Sale`;
      case "Financing":
        return t`Financing`;
      default:
        return t`Rental`;
    }
  };
}

export function useLeaseStandardTerm() {
  const { t } = useLingui();
  return (value: string) => {
    switch (value) {
      case "Sale":
        return t`Sales-type lease`;
      case "Financing":
        return t`Direct financing lease`;
      default:
        return t`Operating lease`;
    }
  };
}

/** The classification badge, with a tooltip saying what it means. */
export function LeaseClassificationBadge({ value }: { value: string }) {
  const { t } = useLingui();
  const label = useLeaseClassificationLabel();
  const standardTerm = useLeaseStandardTerm();
  const description =
    value === "Rental"
      ? t`You keep the unit on your books and depreciate it. Rent is revenue as it is earned.`
      : t`The customer effectively buys the unit. It leaves your fixed assets at commencement, the sale is booked, and interest is earned on the receivable over the term.`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="w-fit">
          <Badge variant={value === "Rental" ? "secondary" : "orange"}>
            {label(value)}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{description}</p>
        <p className="mt-1 text-muted-foreground">{standardTerm(value)}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export type LineLeaseClassification = {
  /** The classification that applies: the stored one once activated or
   *  overridden, else the preview's. */
  classification: LeaseClassificationValue;
  record: LeaseClassificationRecord | null;
  /** Computed here from the terms, not the record activation stored. */
  isPreview: boolean;
  isOverridden: boolean;
  overrideReason: string | null;
};

const asClassification = (
  value: string | null | undefined
): LeaseClassificationValue | null =>
  value === "Rental" || value === "Sale" ? value : null;

/** One line's lessor classification: the record activation stored when there
 *  is one, else a preview from the agreement terms, the line's inputs and
 *  its rates (its own, else the default ladder). An override always wins. */
export function resolveLineLeaseClassification(args: {
  agreement: RentalAgreement;
  line: Pick<
    RentalAgreementLine,
    | "classificationInputs"
    | "classificationOverride"
    | "classificationOverrideReason"
    | "lessorClassification"
    | "rateUnit"
    | "rate"
    | "fairValue"
    | "economicLifeMonths"
    | "guaranteedResidualValue"
    | "unguaranteedResidualValue"
  >;
  policy: LeasePolicy;
}): LineLeaseClassification {
  const { agreement, line, policy } = args;
  const stored = asClassification(line.lessorClassification);
  const overridden = line.classificationOverride && stored !== null;

  const storedRecord =
    agreement.status !== "Draft" && stored
      ? readLeaseClassification(line.classificationInputs, stored)
      : null;
  const record =
    storedRecord ??
    (agreement.startDate
      ? previewLeaseClassification({
          agreement: {
            startDate: agreement.startDate,
            endDate: agreement.endDate,
            billingCycle: agreement.billingCycle ?? "Calendar Month",
            billingTiming: agreement.billingTiming ?? "Advance",
            discountRate: agreement.discountRate ?? 0,
            ownershipTransfers: agreement.ownershipTransfers ?? false,
            specializedAsset: agreement.specializedAsset ?? false,
            purchaseOptionAmount: agreement.purchaseOptionAmount,
            purchaseOptionReasonablyCertain:
              agreement.purchaseOptionReasonablyCertain ?? false
          },
          line: {
            rateUnit: line.rateUnit,
            rate: line.rate,
            fairValue: line.fairValue,
            economicLifeMonths: line.economicLifeMonths,
            guaranteedResidualValue: line.guaranteedResidualValue,
            unguaranteedResidualValue: line.unguaranteedResidualValue
          },
          policy
        })
      : null);

  // Once activated the line's column is the classification of record, even
  // for a line activated before its inputs were stored.
  const classification: LeaseClassificationValue =
    (overridden || agreement.status !== "Draft" ? stored : null) ??
    record?.classification ??
    "Rental";

  return {
    classification,
    record,
    isPreview: storedRecord === null,
    isOverridden: overridden,
    overrideReason: line.classificationOverrideReason
  };
}

const TEST_KEYS: (keyof LeaseClassificationTests)[] = ["a", "b", "c", "d", "e"];

/** The agreement terms as the form currently holds them (unsaved). */
export type LeaseTermsDraft = {
  startDate: string;
  endDate: string | null;
  billingCycle: "Calendar Month" | "28 Days";
  billingTiming: "Advance" | "Arrears";
  discountRate: number;
  ownershipTransfers: boolean;
  specializedAsset: boolean;
  purchaseOptionAmount: number | null;
  purchaseOptionReasonablyCertain: boolean;
};

type LeaseClassificationPreviewProps = {
  terms: LeaseTermsDraft;
  /** The agreement's units, when it has any: tests (c) and (d) are per unit. */
  lines?: RentalAgreementLine[];
  leaseInputs?: Record<string, RentalLeaseLineInputs>;
  policy: LeasePolicy;
};

/** How the agreement would classify on activation, from the unsaved terms:
 *  both classifications side by side (the one that applies solid, the other
 *  faded) and the five ASC 842 tests that decide it. */
export function LeaseClassificationPreview({
  terms,
  lines = [],
  leaseInputs,
  policy
}: LeaseClassificationPreviewProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const standardTerm = useLeaseStandardTerm();
  const percent = (value: number) => formatPercent(value / 100, locale);

  const isOpenEnded = !terms.endDate;
  const units = terms.startDate
    ? lines.map((line) => {
        const record = previewLeaseClassification({
          agreement: terms,
          line: {
            rateUnit: line.rateUnit,
            rate: line.rate,
            fairValue: line.fairValue,
            economicLifeMonths: line.economicLifeMonths,
            guaranteedResidualValue: line.guaranteedResidualValue,
            unguaranteedResidualValue: line.unguaranteedResidualValue
          },
          policy
        });
        // A manual override wins, exactly as on activation.
        const classification: LeaseClassificationValue =
          line.classificationOverride &&
          (line.lessorClassification === "Rental" ||
            line.lessorClassification === "Sale")
            ? line.lessorClassification
            : record.classification;
        return { line, record, classification };
      })
    : [];

  // Tests (a), (b) and (e) are agreement terms; (c) and (d) need each unit's
  // fair value and economic life.
  const agreementTests = {
    a: terms.ownershipTransfers,
    b: terms.purchaseOptionReasonablyCertain,
    e: terms.specializedAsset
  };
  const passingUnits = (key: "c" | "d") =>
    units.filter((unit) => unit.record.tests[key]);

  const classifications = new Set<LeaseClassificationValue>(
    isOpenEnded
      ? ["Rental"]
      : units.length > 0
        ? units.map((unit) => unit.classification)
        : [
            agreementTests.a || agreementTests.b || agreementTests.e
              ? "Sale"
              : "Rental"
          ]
  );
  const unitCount = (value: LeaseClassificationValue) =>
    units.filter((unit) => unit.classification === value).length;

  // Financing (a direct financing lease) is not offered: it needs a
  // third-party residual value guarantee, which an agreement has no input
  // for, so no terms can reach it.
  const options: {
    value: LeaseClassificationValue;
    title: string;
    description: string;
  }[] = [
    {
      value: "Rental",
      title: t`Rental`,
      description: t`You keep the units on your books and depreciate them. Rent is revenue as it is earned.`
    },
    {
      value: "Sale",
      title: t`Sale`,
      description: t`The customer effectively buys the units. They leave your fixed assets on activation, the sale is booked, and interest is earned over the term.`
    }
  ];

  const testRow = (key: keyof LeaseClassificationTests) => {
    let passed: boolean;
    let label: ReactNode;
    let detail: ReactNode = null;
    switch (key) {
      case "a":
        passed = agreementTests.a;
        label = t`Ownership transfers to the customer`;
        break;
      case "b":
        passed = agreementTests.b;
        label = t`Purchase option reasonably certain`;
        break;
      case "e":
        passed = agreementTests.e;
        label = t`Specialized asset with no alternative use`;
        break;
      case "c":
      case "d": {
        const threshold = percent(
          key === "c" ? policy.majorPartPercent : policy.substantiallyAllPercent
        );
        label =
          key === "c"
            ? t`Term is at least ${threshold} of a unit's economic life`
            : t`Present value of the rent is at least ${threshold} of a unit's fair value`;
        const passing = passingUnits(key);
        passed = passing.length > 0;
        if (units.length === 0) {
          detail = t`Checked for each unit once units are added`;
        } else if (units.length === 1) {
          const actual =
            key === "c"
              ? units[0].record.termToLifePercent
              : units[0].record.pvToFairValuePercent;
          detail = actual === null ? t`Not enough unit data` : percent(actual);
        } else {
          const count = passing.length;
          const total = units.length;
          detail = t`${count} of ${total} units`;
        }
        break;
      }
    }
    return (
      <li key={key} className="flex items-center gap-2">
        {passed ? (
          <LuCircleCheck className="text-emerald-500 shrink-0" />
        ) : (
          <LuCircleMinus className="text-muted-foreground shrink-0" />
        )}
        <span className={passed ? undefined : "text-muted-foreground"}>
          {label}
        </span>
        {detail && (
          <span className="text-xs text-muted-foreground">({detail})</span>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {options.map((option) => {
          const applies = classifications.has(option.value);
          const count = unitCount(option.value);
          return (
            <div
              key={option.value}
              className={cn(
                "flex flex-col gap-1 rounded-lg border p-4 transition-opacity",
                applies ? "border-foreground" : "border-border opacity-40"
              )}
            >
              <HStack className="justify-between">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{option.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {standardTerm(option.value)}
                  </span>
                </div>
                {applies &&
                  (units.length > 1 ? (
                    <span className="text-xs text-muted-foreground">
                      {count === 1 ? t`1 unit` : t`${count} units`}
                    </span>
                  ) : (
                    <LuCircleCheck className="shrink-0" />
                  ))}
              </HStack>
              <p className="text-sm text-muted-foreground">
                {option.description}
              </p>
            </div>
          );
        })}
      </div>

      {isOpenEnded ? (
        <p className="text-sm text-muted-foreground">
          <Trans>
            Without an end date this is always treated as a rental: a unit can
            only pass to the customer over a fixed term. Add an end date to test
            whether it is a sale.
          </Trans>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            <Trans>
              A unit is treated as a sale when any of these is true, and as a
              rental otherwise.
            </Trans>
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {TEST_KEYS.map(testRow)}
          </ul>
        </div>
      )}
    </div>
  );
}

type LeaseClassificationPanelProps = LineLeaseClassification & {
  currencyCode: string;
  /** Shown only while the agreement is Draft and the user holds
   *  `update: accounting`. */
  onOverride?: () => void;
};

/** The chip and the five ASC 842 tests behind it. */
export function LeaseClassificationPanel({
  classification,
  record,
  isPreview,
  isOverridden,
  overrideReason,
  currencyCode,
  onOverride
}: LeaseClassificationPanelProps) {
  const { t } = useLingui();
  const { locale } = useLocale();

  const percent = (value: number | null) =>
    value === null ? "—" : formatPercent(value / 100, locale);

  const testLabel = (key: keyof LeaseClassificationTests): ReactNode => {
    const thresholds = record?.thresholds;
    switch (key) {
      case "a":
        return t`Ownership transfers to the customer`;
      case "b":
        return t`Purchase option reasonably certain`;
      case "c": {
        const threshold = percent(thresholds?.majorPartPercent ?? null);
        const actual = percent(record?.termToLifePercent ?? null);
        return t`Term is at least ${threshold} of the economic life (${actual})`;
      }
      case "d": {
        const threshold = percent(thresholds?.substantiallyAllPercent ?? null);
        const actual = percent(record?.pvToFairValuePercent ?? null);
        return t`Present value of payments is at least ${threshold} of fair value (${actual})`;
      }
      case "e":
        return t`Specialized asset with no alternative use`;
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <HStack className="justify-between">
        <HStack spacing={2}>
          <LeaseClassificationBadge value={classification} />
          {isOverridden ? (
            <Badge variant="outline">
              <Trans>Overridden</Trans>
            </Badge>
          ) : (
            isPreview && (
              <Badge variant="outline">
                <Trans>Preview</Trans>
              </Badge>
            )
          )}
        </HStack>
        {onOverride && (
          <Button variant="secondary" size="sm" onClick={onOverride}>
            <Trans>Override</Trans>
          </Button>
        )}
      </HStack>

      {record ? (
        <ul className="flex flex-col gap-1 text-sm">
          {TEST_KEYS.map((key) => (
            <li key={key} className="flex items-center gap-2">
              {record.tests[key] ? (
                <LuCircleCheck className="text-emerald-500 shrink-0" />
              ) : (
                <LuCircleMinus className="text-muted-foreground shrink-0" />
              )}
              <span
                className={
                  record.tests[key] ? undefined : "text-muted-foreground"
                }
              >
                {testLabel(key)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          <Trans>
            Set the agreement's start date to see the accounting treatment.
          </Trans>
        </p>
      )}

      {record && record.inputs.termMonths === null && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            An open-ended agreement is always treated as a rental: a sale needs
            an end date.
          </Trans>
        </p>
      )}

      {record?.pv && (
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">
              <Trans>PV of Payments</Trans>
            </p>
            <RentalMoney
              value={record.pv.pvPayments}
              currencyCode={currencyCode}
            />
          </div>
          <div>
            <p className="text-muted-foreground">
              <Trans>PV of Residual</Trans>
            </p>
            <RentalMoney
              value={record.pv.pvResidual}
              currencyCode={currencyCode}
            />
          </div>
          <div>
            <p className="text-muted-foreground">
              <Trans>Net Investment</Trans>
            </p>
            <RentalMoney
              value={record.pv.netInvestment}
              currencyCode={currencyCode}
            />
          </div>
        </div>
      )}

      {isOverridden && overrideReason && (
        <p className="text-xs text-muted-foreground">
          <Trans>Override reason: {overrideReason}</Trans>
        </p>
      )}
    </div>
  );
}

type LeaseClassificationOverrideModalProps = {
  rentalAgreementId: string;
  lineId: string;
  classification: LeaseClassificationValue;
  onClose: () => void;
};

/** Posts a manual classification with its reason (`update: accounting`). */
export function LeaseClassificationOverrideModal({
  rentalAgreementId,
  lineId,
  classification,
  onClose
}: LeaseClassificationOverrideModalProps) {
  const { t } = useLingui();
  const classificationLabel = useLeaseClassificationLabel();

  const options = lessorClassificationOverrides.map((value) => ({
    value,
    label: classificationLabel(value)
  }));

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={rentalAgreementLineClassificationValidator}
          method="post"
          action={path.to.rentalAgreementLineClassification(
            rentalAgreementId,
            lineId
          )}
          defaultValues={{
            classification: classification === "Sale" ? "Rental" : "Sale",
            reason: ""
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Override Classification</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                The override is kept at activation and recorded in the audit log
                with its reason.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <Select
                name="classification"
                label={t`Classification`}
                options={options}
              />
              <TextArea name="reason" label={t`Reason`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit>
              <Trans>Override</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

type RentalCommencementPreviewProps = {
  rentalAgreement: RentalAgreement;
  lines: RentalAgreementLine[];
  leaseInputs: Record<string, RentalLeaseLineInputs>;
  leasePolicy: LeasePolicy;
};

/** The Activate confirmation's commencement journal preview (spec §4), one
 *  per line that would classify Sale, under a warning when the agreement is
 *  not in the company's base currency (activation refuses it). Nothing
 *  renders when every line is Rental and the currency is the base. */
export function RentalCommencementPreview({
  rentalAgreement,
  lines,
  leaseInputs,
  leasePolicy
}: RentalCommencementPreviewProps) {
  const { t } = useLingui();
  const { company } = useUser();
  const currencyCode = rentalAgreement.currencyCode ?? "";

  const salesType = lines
    .map((line) => ({
      line,
      inputs: leaseInputs[line.id],
      lease: resolveLineLeaseClassification({
        agreement: rentalAgreement,
        line,
        policy: leasePolicy
      })
    }))
    .filter(({ lease }) => lease.classification === "Sale");

  // Activation refuses every agreement outside the base currency, whatever
  // its units' treatment.
  const isForeignCurrency =
    !!company.baseCurrencyCode && currencyCode !== company.baseCurrencyCode;
  const foreignCurrencyWarning = isForeignCurrency ? (
    <p className="text-sm text-destructive">
      <Trans>
        A rental agreement must be in the company's base currency to be
        activated. Change the agreement currency first.
      </Trans>
    </p>
  ) : null;

  if (salesType.length === 0) {
    return foreignCurrencyWarning ? (
      <div className="mt-4">{foreignCurrencyWarning}</div>
    ) : null;
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      {foreignCurrencyWarning}
      <p className="text-sm">
        <Trans>
          These units are treated as sales. Activating derecognizes each one and
          posts its commencement journal:
        </Trans>
      </p>
      {salesType.map(({ line, inputs, lease }) => {
        const label =
          [line.fixedAsset?.fixedAssetId, line.fixedAsset?.name]
            .filter(Boolean)
            .join(" · ") ||
          line.item?.readableIdWithRevision ||
          "";
        const pv = lease.record?.pv;
        const carrying = inputs?.carryingAmount ?? null;
        // Activation applies the same check and refuses the agreement, so a
        // planner sees it here first (end date, fair value, whole periods).
        const requirement = rentalAgreement.startDate
          ? salesTypeRequirementError({
              name: label,
              cycle: rentalAgreement.billingCycle ?? "Calendar Month",
              rateUnit: line.rateUnit,
              startDate: rentalAgreement.startDate,
              endDate: rentalAgreement.endDate ?? null,
              fairValue: line.fairValue ?? null
            })
          : null;

        if (requirement) {
          return (
            <div key={line.id} className="text-sm">
              <p className="font-medium">{label}</p>
              <p className="text-destructive">{requirement}</p>
            </div>
          );
        }

        if (!pv) {
          return (
            <div key={line.id} className="text-sm">
              <p className="font-medium">{label}</p>
              <p className="text-muted-foreground">
                <Trans>
                  Cannot price this lease yet: it needs an end date and a rate
                  for the billing cycle.
                </Trans>
              </p>
            </div>
          );
        }

        const preview =
          carrying === null ? null : leaseCommencementPreview(pv, carrying);

        const rows: {
          account: string;
          debit: number | null;
          credit: number | null;
        }[] = [
          {
            account: t`Net Investment in Leases`,
            debit: pv.netInvestment,
            credit: null
          },
          {
            account: t`Cost of Goods Sold`,
            debit: preview?.costOfGoodsSold ?? null,
            credit: null
          },
          {
            account: t`Lease Revenue`,
            debit: null,
            credit: pv.pvPayments
          },
          {
            account: t`Accumulated Depreciation`,
            debit: inputs?.accumulatedDepreciation ?? null,
            credit: null
          },
          {
            account: t`Fixed Asset (at cost)`,
            debit: null,
            credit: inputs?.acquisitionCost ?? null
          }
        ];

        return (
          <div key={line.id} className="flex flex-col gap-2">
            <p className="text-sm font-medium">{label}</p>
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Account</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Debit</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Credit</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((row) => (
                  <Tr key={row.account}>
                    <Td>{row.account}</Td>
                    <Td className="text-right">
                      {row.debit === null ? (
                        ""
                      ) : (
                        <RentalMoney
                          value={row.debit}
                          currencyCode={currencyCode}
                        />
                      )}
                    </Td>
                    <Td className="text-right">
                      {row.credit === null ? (
                        ""
                      ) : (
                        <RentalMoney
                          value={row.credit}
                          currencyCode={currencyCode}
                        />
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
            {preview ? (
              <p className="text-xs text-muted-foreground">
                <Trans>
                  Selling profit:{" "}
                  <RentalMoney
                    value={preview.sellingProfit}
                    currencyCode={currencyCode}
                  />
                </Trans>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                <Trans>
                  The unit's book value is not visible to you, so its cost of
                  goods sold and asset legs are not shown.
                </Trans>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
