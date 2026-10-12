// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  cn,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { formatPercent } from "@carbon/utils";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ReactNode } from "react";
import { useState } from "react";
import { LuCircleCheck, LuCircleMinus } from "react-icons/lu";
import Money from "~/components/Money";
import { usePermissions } from "~/hooks";
import {
  LeaseClassificationOverrideModal,
  RemoveClassificationOverride
} from "./LeaseClassificationOverrideModal";
import {
  LesseeClassificationBadge,
  useLesseeClassificationDescription,
  useLesseeClassificationLabel
} from "./LesseeClassificationBadge";
import OpenEndedExpedientNotice from "./OpenEndedExpedientNotice";
import type {
  Lease,
  LeaseLine,
  LeasePayment,
  LeasePolicy,
  LesseeClassificationType
} from "./types";
import {
  assetClassificationPreviews,
  type LesseeClassificationPreview
} from "./utils";

const TEST_KEYS = ["a", "b", "c", "d", "e"] as const;

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

  const { assets, errors } = assetClassificationPreviews(
    lease,
    lines,
    payments,
    policy
  );
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
  const errorList = errors.length > 0 && (
    <ul className="flex flex-col gap-1 text-sm text-destructive">
      {errors.map(({ line, message }) => (
        <li key={line.id}>
          <Trans>
            {line.description}: the treatment cannot be worked out. {message}
          </Trans>
        </li>
      ))}
    </ul>
  );
  if (assets.length === 0) {
    return (
      errorList || (
        <p className="text-sm text-muted-foreground">
          <Trans>
            Set the commencement date, the end date and the payment terms to see
            the accounting treatment.
          </Trans>
        </p>
      )
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
      {errorList}
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
                      <Plural value={count} one="# asset" other="# assets" />
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
            <Plural value={termMonths} one="# month" other="# months" />
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
                <Money
                  value={asset.preview.pvPayments}
                  currencyCode={lease.currencyCode}
                />
              </Td>
              {canOverride && (
                <Td className="text-right">
                  <HStack spacing={2} className="justify-end">
                    {asset.preview.isOverridden && lease.id && (
                      <RemoveClassificationOverride
                        leaseId={lease.id}
                        leaseLineId={asset.line.id}
                      />
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setOverriding(asset)}
                    >
                      <Trans>Override</Trans>
                    </Button>
                  </HStack>
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
