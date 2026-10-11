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
  useDisclosure,
  VStack
} from "@carbon/react";
import { formatPercent } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ReactNode } from "react";
import { useCallback } from "react";
import { LuCircleCheck, LuCircleMinus } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Select, Submit, TextArea } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { leaseClassificationValidator } from "../../purchasing.models";
import LeaseMoney from "./LeaseMoney";
import type {
  Lease,
  LeasePayment,
  LeasePolicy,
  LesseeClassificationType
} from "./types";
import { previewLesseeClassification } from "./utils";

/** A lessee classification's name on screen. */
export function useLesseeClassificationLabel() {
  const { t } = useLingui();
  return useCallback(
    (value: string) => {
      switch (value) {
        case "Finance":
          return t`Finance`;
        case "Short-Term":
          return t`Short-Term`;
        default:
          return t`Operating`;
      }
    },
    [t]
  );
}

function useLesseeClassificationDescription() {
  const { t } = useLingui();
  return (value: string) => {
    switch (value) {
      case "Finance":
        return t`You effectively buy the asset. Interest and amortization of the right-of-use asset are booked separately each month.`;
      case "Short-Term":
        return t`Twelve months or less. Nothing goes on the balance sheet; each invoice is expensed.`;
      default:
        return t`The right-of-use asset and the lease liability are on the balance sheet, and one straight-line lease cost is booked each month.`;
    }
  };
}

/** The classification badge, with a tooltip saying what it means. */
export function LesseeClassificationBadge({ value }: { value: string }) {
  const label = useLesseeClassificationLabel();
  const description = useLesseeClassificationDescription();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="w-fit">
          <Badge variant={value === "Finance" ? "orange" : "secondary"}>
            {label(value)}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{description(value)}</p>
      </TooltipContent>
    </Tooltip>
  );
}

const TEST_KEYS = ["a", "b", "c", "d", "e"] as const;

type LeaseClassificationPreviewProps = {
  lease: Lease;
  payments: LeasePayment[];
  policy: LeasePolicy;
};

/** How the lease would classify on activation, from its payment rows: the
 *  three treatments side by side (the one that applies solid), the five ASC
 *  842 tests that decide it, and the present value of the payments. An
 *  accountant can override it while the lease is Draft. */
export function LeaseClassificationPreview({
  lease,
  payments,
  policy
}: LeaseClassificationPreviewProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const permissions = usePermissions();
  const overrideModal = useDisclosure();
  const label = useLesseeClassificationLabel();
  const description = useLesseeClassificationDescription();

  const preview = previewLesseeClassification({ lease, payments, policy });
  const percent = (value: number) => formatPercent(value / 100, locale);
  const canOverride =
    lease.status === "Draft" && permissions.can("update", "accounting");

  if (!preview) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>
          Set the commencement date, the end date and the payment terms to see
          the accounting treatment.
        </Trans>
      </p>
    );
  }

  const options: LesseeClassificationType[] = [
    "Operating",
    "Finance",
    "Short-Term"
  ];

  const testRow = (key: (typeof TEST_KEYS)[number]) => {
    const passed = preview.tests[key];
    let text: ReactNode;
    let detail: ReactNode = null;
    switch (key) {
      case "a":
        text = t`Ownership transfers to you by the end of the term`;
        break;
      case "b":
        text = t`Purchase option reasonably certain`;
        break;
      case "c": {
        const threshold = percent(policy.majorPartPercent);
        text = t`Term is at least ${threshold} of the economic life`;
        detail =
          preview.termToLifePercent === null
            ? t`No economic life entered, counts as not met`
            : percent(preview.termToLifePercent);
        break;
      }
      case "d": {
        const threshold = percent(policy.substantiallyAllPercent);
        text = t`Present value of the payments is at least ${threshold} of the fair value`;
        detail =
          preview.pvToFairValuePercent === null
            ? t`No fair value entered, counts as not met`
            : percent(preview.pvToFairValuePercent);
        break;
      }
      case "e":
        text = t`Specialized asset with no alternative use`;
        break;
    }
    return (
      <li key={key} className="flex items-start gap-2">
        {passed ? (
          <LuCircleCheck className="text-emerald-500 shrink-0 mt-0.5" />
        ) : (
          <LuCircleMinus className="text-muted-foreground shrink-0 mt-0.5" />
        )}
        <span className={passed ? undefined : "text-muted-foreground"}>
          {text}
          {detail && (
            <span className="ml-1 text-xs text-muted-foreground">
              ({detail})
            </span>
          )}
        </span>
      </li>
    );
  };

  return (
    <div className="@container flex flex-col gap-4 w-full">
      <div className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
        {options.map((option) => {
          const applies = preview.applied === option;
          return (
            <div
              key={option}
              className={cn(
                "flex flex-col gap-1 rounded-lg border p-4 transition-opacity",
                applies ? "border-foreground" : "border-border opacity-40"
              )}
            >
              <HStack className="justify-between">
                <span className="text-sm font-medium">{label(option)}</span>
                {applies && <LuCircleCheck className="shrink-0" />}
              </HStack>
              <p className="text-sm text-muted-foreground">
                {description(option)}
              </p>
            </div>
          );
        })}
      </div>

      <HStack className="justify-between flex-wrap">
        <HStack spacing={2} className="flex-wrap">
          <LesseeClassificationBadge value={preview.applied} />
          {preview.isOverridden ? (
            <Badge variant="outline">
              <Trans>Overridden</Trans>
            </Badge>
          ) : (
            <Badge variant="outline">
              <Trans>Preview</Trans>
            </Badge>
          )}
        </HStack>
        {canOverride && (
          <Button variant="secondary" size="sm" onClick={overrideModal.onOpen}>
            <Trans>Override</Trans>
          </Button>
        )}
      </HStack>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {policy.shortTermExpedient ? (
            <Trans>
              A lease of 12 months or less with no purchase option reasonably
              certain is short-term. Otherwise it is a finance lease when any of
              these is true, and an operating lease when none is.
            </Trans>
          ) : (
            <Trans>
              A finance lease when any of these is true, and an operating lease
              when none is.
            </Trans>
          )}
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {TEST_KEYS.map(testRow)}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-4 text-sm @md:grid-cols-3">
        <div>
          <p className="text-muted-foreground">
            <Trans>Term</Trans>
          </p>
          <span className="tabular-nums">
            {preview.termMonths === 1
              ? t`1 month`
              : t`${preview.termMonths} months`}
          </span>
        </div>
        <div>
          <p className="text-muted-foreground">
            <Trans>Discount Rate</Trans>
          </p>
          <span className="tabular-nums">
            {percent(Number(lease.discountRate ?? 0))}
          </span>
        </div>
        <div>
          <p className="text-muted-foreground">
            <Trans>PV of Payments</Trans>
          </p>
          <LeaseMoney
            value={preview.pvPayments}
            currencyCode={lease.currencyCode}
          />
        </div>
      </div>

      {preview.isOverridden && lease.classificationOverrideReason && (
        <p className="text-xs text-muted-foreground">
          <Trans>Override reason: {lease.classificationOverrideReason}</Trans>
        </p>
      )}

      {overrideModal.isOpen && lease.id && (
        <LeaseClassificationOverrideModal
          leaseId={lease.id}
          classification={preview.applied}
          onClose={overrideModal.onClose}
        />
      )}
    </div>
  );
}

type LeaseClassificationOverrideModalProps = {
  leaseId: string;
  classification: LesseeClassificationType;
  onClose: () => void;
};

/** Posts a manual classification with its reason (`update: accounting`). */
export function LeaseClassificationOverrideModal({
  leaseId,
  classification,
  onClose
}: LeaseClassificationOverrideModalProps) {
  const { t } = useLingui();
  const label = useLesseeClassificationLabel();
  const fetcher = useFetcher<{}>();

  const options = (["Operating", "Finance"] as const).map((value) => ({
    value,
    label: label(value)
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
          validator={leaseClassificationValidator}
          method="post"
          action={path.to.leaseClassification(leaseId)}
          fetcher={fetcher}
          defaultValues={{
            classification:
              classification === "Finance" ? "Operating" : "Finance",
            reason: ""
          }}
          onSubmit={onClose}
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

type LeaseCommencementPreviewProps = {
  lease: Lease;
  payments: LeasePayment[];
  policy: LeasePolicy;
};

/** The Activate confirmation's preview: the classification and the
 *  commencement journal it posts (none for a short-term lease), under a
 *  warning when the lease is not in the base currency. */
export function LeaseCommencementPreview({
  lease,
  payments,
  policy
}: LeaseCommencementPreviewProps) {
  const { t } = useLingui();
  const { company } = useUser();
  const preview = previewLesseeClassification({ lease, payments, policy });

  const isForeignCurrency =
    !!company.baseCurrencyCode &&
    !!lease.currencyCode &&
    lease.currencyCode !== company.baseCurrencyCode;

  return (
    <div className="mt-4 flex flex-col gap-4">
      {isForeignCurrency && (
        <p className="text-sm text-destructive">
          <Trans>
            A lease must be in the company's base currency to be activated.
          </Trans>
        </p>
      )}
      {payments.length === 0 && (
        <p className="text-sm text-destructive">
          <Trans>Add at least one payment row before activating.</Trans>
        </p>
      )}
      {preview && (
        <>
          <HStack spacing={2}>
            <span className="text-sm">
              <Trans>Classification:</Trans>
            </span>
            <LesseeClassificationBadge value={preview.applied} />
          </HStack>
          {preview.applied === "Short-Term" ? (
            <p className="text-sm text-muted-foreground">
              <Trans>
                A short-term lease posts no journal at activation. Each invoice
                is expensed when it posts.
              </Trans>
            </p>
          ) : (
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
                <Tr>
                  <Td>{t`Right-of-Use Asset`}</Td>
                  <Td className="text-right">
                    <LeaseMoney
                      value={preview.pvPayments}
                      currencyCode={lease.currencyCode}
                    />
                  </Td>
                  <Td />
                </Tr>
                <Tr>
                  <Td>{t`Lease Liability`}</Td>
                  <Td />
                  <Td className="text-right">
                    <LeaseMoney
                      value={preview.pvPayments}
                      currencyCode={lease.currencyCode}
                    />
                  </Td>
                </Tr>
              </Tbody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
