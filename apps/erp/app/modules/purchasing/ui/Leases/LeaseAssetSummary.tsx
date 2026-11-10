// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuCircleStop, LuHandCoins } from "react-icons/lu";
import { Link } from "react-router";
import { useLocations } from "~/components/Form/Location";
import Money from "~/components/Money";
import { path } from "~/utils/path";
import LeaseStatus from "./LeaseStatus";
import { LesseeClassificationBadge } from "./LesseeClassificationBadge";
import type {
  Lease,
  LeaseFixedAssets,
  LeaseLine,
  LeasePayment,
  LeaseScheduleLine
} from "./types";
import { useLeaseAssetActions } from "./useLeaseAssetActions";
import { useLeaseFrequencyLabel } from "./useLeaseLabels";
import { leaseAssetLiability } from "./utils";

type LeaseAssetSummaryProps = {
  lease: Lease;
  line: LeaseLine;
  payments: LeasePayment[];
  schedule: LeaseScheduleLine[];
  fixedAssets: LeaseFixedAssets;
};

/** The top of an asset's page: what the lease pays for it, how it is
 *  accounted for, and what can happen to it next. */
const LeaseAssetSummary = ({
  lease,
  line,
  payments,
  schedule,
  fixedAssets
}: LeaseAssetSummaryProps) => {
  const { t } = useLingui();
  const locations = useLocations();
  const frequencyLabel = useLeaseFrequencyLabel();
  const actions = useLeaseAssetActions({ lease, payments, schedule });
  const state = actions.stateOf(line);

  const currencyCode = lease.currencyCode;
  const locationId = line.locationId ?? lease.locationId;
  const locationName = locations.find(
    (location) => location.value === locationId
  )?.label;
  const liability = leaseAssetLiability(line, schedule);
  const fixedAsset = line.fixedAssetId
    ? fixedAssets[line.fixedAssetId]
    : undefined;
  const frequency = frequencyLabel(lease.paymentFrequency, "per");

  return (
    <>
      <Card>
        <CardHeader>
          <HStack className="justify-between w-full">
            <CardTitle>{line.description}</CardTitle>
            <HStack spacing={2}>
              {line.lesseeClassification && (
                <LesseeClassificationBadge value={line.lesseeClassification} />
              )}
              <LeaseStatus
                status={lease.status === "Draft" ? "Draft" : line.status}
              />
            </HStack>
          </HStack>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border border-t border-border">
            <DetailRow label={t`Serial Number`}>
              {line.serialNumber || "—"}
            </DetailRow>
            <DetailRow label={t`Location`}>
              {line.locationId
                ? (locationName ?? "—")
                : locationName
                  ? t`${locationName} (the lease's)`
                  : "—"}
            </DetailRow>
            <DetailRow label={t`Payment`}>
              <Money value={line.paymentAmount} currencyCode={currencyCode} />{" "}
              <span className="text-muted-foreground font-normal">
                {frequency}
              </span>
            </DetailRow>
            <DetailRow label={t`Initial Liability`}>
              {line.initialLiability === null ? (
                "—"
              ) : (
                <Money
                  value={line.initialLiability}
                  currencyCode={currencyCode}
                />
              )}
            </DetailRow>
            <DetailRow label={t`Lease Liability`}>
              {liability === null ? (
                "—"
              ) : (
                <Money value={liability} currencyCode={currencyCode} />
              )}
            </DetailRow>
            {fixedAsset && (
              <DetailRow label={t`Fixed Asset`}>
                <Link
                  to={path.to.fixedAsset(fixedAsset.id)}
                  className="hover:underline"
                >
                  {fixedAsset.fixedAssetId ?? fixedAsset.name}
                </Link>
              </DetailRow>
            )}
          </div>
        </CardContent>
        {(state.canTerminate || state.purchase) && (
          <CardFooter>
            <HStack>
              {state.canTerminate && (
                <Button
                  variant="secondary"
                  leftIcon={<LuCircleStop />}
                  onClick={() => actions.open("terminate", line)}
                >
                  <Trans>Terminate</Trans>
                </Button>
              )}
              {state.purchase && (
                <Button
                  variant="secondary"
                  leftIcon={<LuHandCoins />}
                  onClick={() => actions.open("purchase", line)}
                >
                  {state.purchase.kind === "ownership" ? (
                    <Trans>Take Ownership</Trans>
                  ) : (
                    <Trans>Exercise Purchase Option</Trans>
                  )}
                </Button>
              )}
            </HStack>
          </CardFooter>
        )}
      </Card>
      {actions.modals}
    </>
  );
};

function DetailRow({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3 text-base sm:text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

export default LeaseAssetSummary;
