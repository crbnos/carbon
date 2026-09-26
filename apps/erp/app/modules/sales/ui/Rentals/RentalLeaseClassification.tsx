import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
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

type LeaseClassificationValue = "Operating" | "Sales-Type";

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
  value === "Operating" || value === "Sales-Type" ? value : null;

/** One line's lessor classification: the record activation stored when there
 *  is one, else a preview from the agreement terms, the line's inputs and the
 *  item's current ladder. An override always wins. */
export function resolveLineLeaseClassification(args: {
  agreement: RentalAgreement;
  line: Pick<
    RentalAgreementLine,
    | "classificationInputs"
    | "classificationOverride"
    | "classificationOverrideReason"
    | "lessorClassification"
    | "rateMode"
    | "rateUnit"
    | "fairValue"
    | "economicLifeMonths"
    | "guaranteedResidualValue"
    | "unguaranteedResidualValue"
  >;
  ladder: RentalLeaseLineInputs["ladder"] | undefined;
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
            rateMode: line.rateMode,
            rateUnit: line.rateUnit,
            fairValue: line.fairValue,
            economicLifeMonths: line.economicLifeMonths,
            guaranteedResidualValue: line.guaranteedResidualValue,
            unguaranteedResidualValue: line.unguaranteedResidualValue
          },
          ladder: args.ladder,
          policy
        })
      : null);

  // Once activated the line's column is the classification of record, even
  // for a line activated before its inputs were stored.
  const classification: LeaseClassificationValue =
    (overridden || agreement.status !== "Draft" ? stored : null) ??
    record?.classification ??
    "Operating";

  return {
    classification,
    record,
    isPreview: storedRecord === null,
    isOverridden: overridden,
    overrideReason: line.classificationOverrideReason
  };
}

const TEST_KEYS: (keyof LeaseClassificationTests)[] = ["a", "b", "c", "d", "e"];

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
          <Badge
            variant={classification === "Sales-Type" ? "orange" : "secondary"}
          >
            {classification === "Sales-Type" ? (
              <Trans>Sales-Type</Trans>
            ) : (
              <Trans>Operating</Trans>
            )}
          </Badge>
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
          <Trans>Set the agreement's start date to classify the lease.</Trans>
        </p>
      )}

      {record && record.inputs.termMonths === null && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            An open-ended agreement is always an operating lease: a sales-type
            lease needs an end date.
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

  const options = lessorClassificationOverrides.map((value) => ({
    value,
    label: value === "Sales-Type" ? t`Sales-Type` : t`Operating`
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
            classification:
              classification === "Sales-Type" ? "Operating" : "Sales-Type",
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
 *  per line that would classify Sales-Type. Nothing renders when every line
 *  is Operating. */
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
        ladder: leaseInputs[line.id]?.ladder,
        policy: leasePolicy
      })
    }))
    .filter(({ lease }) => lease.classification === "Sales-Type");

  if (salesType.length === 0) return null;

  const isForeignCurrency =
    !!company.baseCurrencyCode && currencyCode !== company.baseCurrencyCode;

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-sm">
        <Trans>
          These units classify as sales-type leases. Activating derecognizes
          each one and posts its commencement journal:
        </Trans>
      </p>
      {isForeignCurrency && (
        <p className="text-sm text-destructive">
          <Trans>
            A sales-type lease must be in the company's base currency. Change
            the agreement currency or override the classification.
          </Trans>
        </p>
      )}
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
