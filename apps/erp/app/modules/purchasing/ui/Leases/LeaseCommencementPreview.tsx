// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate, lesseeCommencementLegs } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useUser } from "~/hooks";
import LeaseJournalPreview from "./LeaseJournalPreview";
import OpenEndedExpedientNotice from "./OpenEndedExpedientNotice";
import type { Lease, LeaseLine, LeasePayment, LeasePolicy } from "./types";
import { useLeaseLegLabel } from "./useLeaseLabels";
import {
  assetClassificationPreviews,
  leaseActivationGaps,
  leaseJournalRows,
  skippedPaymentBlockers
} from "./utils";

type LeaseCommencementPreviewProps = {
  lease: Lease;
  lines: LeaseLine[];
  payments: LeasePayment[];
  policy: LeasePolicy;
};

/** The Activate confirmation's preview: each asset's commencement journal
 *  (none for a short-term asset), under a warning for anything that stops
 *  the lease from activating. */
export function LeaseCommencementPreview({
  lease,
  lines,
  payments,
  policy
}: LeaseCommencementPreviewProps) {
  const { company } = useUser();
  const { locale } = useLocale();
  const legLabel = useLeaseLegLabel();
  const { assets, errors } = assetClassificationPreviews(
    lease,
    lines,
    payments,
    policy
  );
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
  const skipped = gaps.includes("skippedPayment")
    ? skippedPaymentBlockers({ lease, lines, payments, policy })
    : [];
  const several = lines.length > 1;
  const journal = recognized.flatMap((asset) =>
    leaseJournalRows(
      lesseeCommencementLegs({ liability: asset.preview.pvPayments }),
      (leg) =>
        several
          ? `${legLabel(leg.account)} — ${asset.line.description}`
          : legLabel(leg.account)
    )
  );

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
      {skipped.map((blocker) => {
        const dueDate = formatDate(blocker.dueDate, undefined, locale);
        return (
          <p
            key={`${blocker.leaseLineId}-${blocker.dueDate}`}
            className="text-sm text-destructive"
          >
            <Trans>
              {blocker.description}: the payment due {dueDate} is marked paid
              outside Carbon, but nothing would relieve it from the lease
              liability. Set Invoice From on or before {dueDate} so it is
              invoiced.
            </Trans>
          </p>
        );
      })}
      {errors.map(({ line, message }) => (
        <p key={line.id} className="text-sm text-destructive">
          <Trans>
            {line.description}: the treatment cannot be worked out. {message}
          </Trans>
        </p>
      ))}
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
          <LeaseJournalPreview
            rows={journal}
            currencyCode={lease.currencyCode}
          />
        ))}
    </div>
  );
}

export default LeaseCommencementPreview;
