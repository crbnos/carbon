// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
import { formatDate, formatPercent } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { LuCircleCheck, LuCircleMinus, LuTriangleAlert } from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { Select, Submit, TextArea } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { leaseClassificationValidator } from "../../purchasing.models";
import LeaseMoney from "./LeaseMoney";
import type {
  Lease,
  LeaseLine,
  LeasePayment,
  LeasePolicy,
  LesseeClassificationType
} from "./types";
import {
  type LesseeClassificationPreview,
  leaseActivationGaps,
  previewLesseeClassification
} from "./utils";

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

/** Why an open-ended lease cannot activate while the short-term expedient is
 *  off, with both ways to fix it linked: turn the expedient on, or give the
 *  lease a fixed duration. Mirrors `OPEN_ENDED_NEEDS_EXPEDIENT`. */
export function OpenEndedExpedientNotice({ leaseId }: { leaseId: string }) {
  return (
    <Alert variant="destructive">
      <LuTriangleAlert className="h-4 w-4" />
      <AlertTitle>
        <Trans>The short-term lease expedient is off</Trans>
      </AlertTitle>
      <AlertDescription>
        <p>
          <Trans>
            An open-ended lease can be ended on notice, so it is a short-term
            lease. This company does not account for short-term leases off the
            balance sheet, so it cannot be activated. Either:
          </Trans>
        </p>
        <ul className="mt-2 list-disc pl-5">
          <li>
            <Trans>
              Turn on{" "}
              <Link
                to={`${path.to.accountingSettings}#lease-classification`}
                className="font-medium underline"
              >
                Short-Term Lease Expedient in Settings → Accounting
              </Link>
              , or
            </Trans>
          </li>
          <li>
            <Trans>
              Give the lease a{" "}
              <Link
                to={path.to.leaseSetup(leaseId, "details")}
                className="font-medium underline"
              >
                fixed duration on its Details step
              </Link>
              .
            </Trans>
          </li>
        </ul>
      </AlertDescription>
    </Alert>
  );
}

/** An open-ended lease's treatment: every asset is short-term. */
function OpenEndedTreatment({
  lease,
  policy
}: {
  lease: Lease;
  policy: LeasePolicy;
}) {
  const description = useLesseeClassificationDescription();
  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="flex flex-col gap-1 rounded-lg border border-foreground p-4">
        <HStack className="justify-between">
          <LesseeClassificationBadge value="Short-Term" />
          <LuCircleCheck className="shrink-0" />
        </HStack>
        <p className="text-sm text-muted-foreground">
          {description("Short-Term")}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        <Trans>
          This lease is open-ended: it can be ended on notice, so its term is
          short and every asset is short-term. Nothing goes on the balance
          sheet, and each invoice is expensed.
        </Trans>
      </p>
      {!policy.shortTermExpedient && lease.id && (
        <OpenEndedExpedientNotice leaseId={lease.id} />
      )}
    </div>
  );
}

type AssetPreview = {
  line: LeaseLine;
  preview: LesseeClassificationPreview;
};

/** Each asset's preview, in the lease's order; an asset whose preview cannot
 *  be read is left out. */
function useAssetPreviews(
  lease: Lease,
  lines: LeaseLine[],
  payments: LeasePayment[],
  policy: LeasePolicy
): AssetPreview[] {
  return lines.flatMap((line) => {
    const preview = previewLesseeClassification({
      lease,
      line,
      payments,
      policy
    });
    return preview ? [{ line, preview }] : [];
  });
}

type LeaseClassificationPreviewProps = {
  lease: Lease;
  lines: LeaseLine[];
  payments: LeasePayment[];
  policy: LeasePolicy;
};

/** How each asset would classify on activation, from its payment rows: the
 *  three treatments side by side (each one that applies solid, with how many
 *  assets take it), the five ASC 842 tests that decide it, and each asset's
 *  present value. An accountant can override an asset while the lease is
 *  Draft. */
export function LeaseClassificationPreview({
  lease,
  lines,
  payments,
  policy
}: LeaseClassificationPreviewProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const permissions = usePermissions();
  const label = useLesseeClassificationLabel();
  const description = useLesseeClassificationDescription();
  const [overriding, setOverriding] = useState<AssetPreview | null>(null);

  const assets = useAssetPreviews(lease, lines, payments, policy);
  const percent = (value: number) => formatPercent(value / 100, locale);
  const canOverride =
    lease.status === "Draft" && permissions.can("update", "accounting");
  const isSingle = assets.length === 1;

  if (!lease.endDate) {
    return <OpenEndedTreatment lease={lease} policy={policy} />;
  }
  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>
          Add the leased assets to see how each one is accounted for.
        </Trans>
      </p>
    );
  }
  if (assets.length === 0) {
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
  const countOf = (value: LesseeClassificationType) =>
    assets.filter((asset) => asset.preview.applied === value).length;
  const total = assets.length;
  const termMonths = assets[0]!.preview.termMonths;

  const testRow = (key: (typeof TEST_KEYS)[number]) => {
    const passing = assets.filter((asset) => asset.preview.tests[key]).length;
    const only = isSingle ? assets[0]!.preview : null;
    let text: ReactNode;
    let detail: ReactNode = isSingle ? null : t`${passing} of ${total} assets`;
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
        if (only) {
          detail =
            only.termToLifePercent === null
              ? t`No economic life entered, counts as not met`
              : percent(only.termToLifePercent);
        }
        break;
      }
      case "d": {
        const threshold = percent(policy.substantiallyAllPercent);
        text = t`Present value of the payments is at least ${threshold} of the fair value`;
        if (only) {
          detail =
            only.pvToFairValuePercent === null
              ? t`No fair value entered, counts as not met`
              : percent(only.pvToFairValuePercent);
        }
        break;
      }
      case "e":
        text = t`Specialized asset with no alternative use`;
        break;
    }
    return (
      <li key={key} className="flex items-start gap-2">
        {passing > 0 ? (
          <LuCircleCheck className="text-emerald-500 shrink-0 mt-0.5" />
        ) : (
          <LuCircleMinus className="text-muted-foreground shrink-0 mt-0.5" />
        )}
        <span className={passing > 0 ? undefined : "text-muted-foreground"}>
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
          const count = countOf(option);
          return (
            <div
              key={option}
              className={cn(
                "flex flex-col gap-1 rounded-lg border p-4 transition-opacity",
                count > 0 ? "border-foreground" : "border-border opacity-40"
              )}
            >
              <HStack className="justify-between">
                <span className="text-sm font-medium">{label(option)}</span>
                {count > 0 &&
                  (isSingle ? (
                    <LuCircleCheck className="shrink-0" />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {count === 1 ? t`1 asset` : t`${count} assets`}
                    </span>
                  ))}
              </HStack>
              <p className="text-sm text-muted-foreground">
                {description(option)}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {policy.shortTermExpedient ? (
            <Trans>
              An asset leased for 12 months or less with no purchase option
              reasonably certain is short-term. Otherwise it is a finance lease
              when any of these is true, and an operating lease when none is.
            </Trans>
          ) : (
            <Trans>
              An asset is a finance lease when any of these is true, and an
              operating lease when none is.
            </Trans>
          )}
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {TEST_KEYS.map(testRow)}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-4 text-sm @md:grid-cols-2">
        <div>
          <p className="text-muted-foreground">
            <Trans>Term</Trans>
          </p>
          <span className="tabular-nums">
            {termMonths === 1 ? t`1 month` : t`${termMonths} months`}
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
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>
              <Trans>Asset</Trans>
            </Th>
            <Th>
              <Trans>Classification</Trans>
            </Th>
            <Th className="text-right">
              <Trans>PV of Payments</Trans>
            </Th>
            {canOverride && <Th />}
          </Tr>
        </Thead>
        <Tbody>
          {assets.map((asset) => (
            <Tr key={asset.line.id}>
              <Td>
                <span className="font-medium">{asset.line.description}</span>
                {asset.preview.isOverridden &&
                  asset.line.classificationOverrideReason && (
                    <p className="text-xs text-muted-foreground">
                      <Trans>
                        Override reason:{" "}
                        {asset.line.classificationOverrideReason}
                      </Trans>
                    </p>
                  )}
              </Td>
              <Td>
                <HStack spacing={2}>
                  <LesseeClassificationBadge value={asset.preview.applied} />
                  {asset.preview.isOverridden && (
                    <Badge variant="outline">
                      <Trans>Overridden</Trans>
                    </Badge>
                  )}
                </HStack>
              </Td>
              <Td className="text-right">
                <LeaseMoney
                  value={asset.preview.pvPayments}
                  currencyCode={lease.currencyCode}
                />
              </Td>
              {canOverride && (
                <Td className="text-right">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setOverriding(asset)}
                  >
                    <Trans>Override</Trans>
                  </Button>
                </Td>
              )}
            </Tr>
          ))}
        </Tbody>
      </Table>

      {overriding && lease.id && (
        <LeaseClassificationOverrideModal
          leaseId={lease.id}
          line={overriding.line}
          classification={overriding.preview.applied}
          onClose={() => setOverriding(null)}
        />
      )}
    </div>
  );
}

type LeaseClassificationOverrideModalProps = {
  leaseId: string;
  line: Pick<LeaseLine, "id" | "description">;
  classification: LesseeClassificationType;
  onClose: () => void;
};

/** Posts a manual classification of one asset with its reason
 *  (`update: accounting`). */
export function LeaseClassificationOverrideModal({
  leaseId,
  line,
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
          action={path.to.leaseLineClassification(leaseId, line.id)}
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
              <Trans>Override Classification of {line.description}</Trans>
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
  lines: LeaseLine[];
  payments: LeasePayment[];
  policy: LeasePolicy;
};

/** The Activate confirmation's preview: each asset's classification and the
 *  commencement journal it posts (none for a short-term asset), under a
 *  warning when the lease cannot activate. */
export function LeaseCommencementPreview({
  lease,
  lines,
  payments,
  policy
}: LeaseCommencementPreviewProps) {
  const { t } = useLingui();
  const { company } = useUser();
  const { locale } = useLocale();
  const assets = useAssetPreviews(lease, lines, payments, policy);
  const recognized = assets.filter(
    (asset) => asset.preview.applied !== "Short-Term"
  );
  const shortTerm = assets.filter(
    (asset) => asset.preview.applied === "Short-Term"
  );
  // A lease that started before accounting was set up posts an opening
  // balance on the cutover (or the first open period after it), not a
  // commencement journal (post-lease, spec Q8).
  const cutoverDate = policy.accountingCutoverDate;
  const opensAtCutover =
    !!cutoverDate &&
    !!lease.commencementDate &&
    lease.commencementDate < cutoverDate;
  const gaps = leaseActivationGaps({
    lease,
    lines,
    payments,
    baseCurrencyCode: company.baseCurrencyCode,
    policy
  });

  return (
    <div className="mt-4 flex flex-col gap-4">
      {gaps.includes("foreignCurrency") && (
        <p className="text-sm text-destructive">
          <Trans>
            A lease must be in the company's base currency to be activated.
          </Trans>
        </p>
      )}
      {gaps.includes("openEndedWithoutExpedient") && lease.id && (
        <OpenEndedExpedientNotice leaseId={lease.id} />
      )}
      {gaps.includes("noAssets") && (
        <p className="text-sm text-destructive">
          <Trans>Add at least one asset before activating.</Trans>
        </p>
      )}
      {gaps.includes("assetWithoutPayments") && (
        <p className="text-sm text-destructive">
          <Trans>Every asset needs a payment row before activating.</Trans>
        </p>
      )}
      {!lease.endDate && !gaps.includes("openEndedWithoutExpedient") && (
        <p className="text-sm text-muted-foreground">
          <Trans>
            An open-ended lease is short-term: activating it posts no journal,
            and each invoice is expensed.
          </Trans>
        </p>
      )}
      {shortTerm.length > 0 && (
        <p className="text-sm text-muted-foreground">
          <Trans>
            A short-term asset posts no journal at activation. Each invoice is
            expensed when it posts.
          </Trans>
        </p>
      )}
      {recognized.length > 0 &&
        (opensAtCutover ? (
          <p className="text-sm text-muted-foreground">
            <Trans>
              This lease started before accounting was set up. Activating it
              posts an opening balance on{" "}
              {formatDate(cutoverDate, undefined, locale)} (or the start of the
              first open period after it): each asset's right-of-use asset, its
              amortization and its lease liability as of that date, with the
              difference to retained earnings. The months before are marked as
              posted.
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
              {recognized.flatMap((asset) => [
                <Tr key={`${asset.line.id}-rou`}>
                  <Td>
                    {t`Right-of-Use Asset`}
                    {lines.length > 1 && (
                      <span className="ml-1 text-muted-foreground">
                        {asset.line.description}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <LeaseMoney
                      value={asset.preview.pvPayments}
                      currencyCode={lease.currencyCode}
                    />
                  </Td>
                  <Td />
                </Tr>,
                <Tr key={`${asset.line.id}-liability`}>
                  <Td>
                    {t`Lease Liability`}
                    {lines.length > 1 && (
                      <span className="ml-1 text-muted-foreground">
                        {asset.line.description}
                      </span>
                    )}
                  </Td>
                  <Td />
                  <Td className="text-right">
                    <LeaseMoney
                      value={asset.preview.pvPayments}
                      currencyCode={lease.currencyCode}
                    />
                  </Td>
                </Tr>
              ])}
            </Tbody>
          </Table>
        ))}
    </div>
  );
}
