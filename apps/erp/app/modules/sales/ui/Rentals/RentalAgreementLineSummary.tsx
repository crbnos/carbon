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
import {
  LuBadgeDollarSign,
  LuCircleSlash,
  LuTrash,
  LuTruck,
  LuUndo2
} from "react-icons/lu";
import { Link } from "react-router";
import { DateTime } from "~/components";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { rentalLineDocuments } from "../../sales.utils";
import { LeaseClassificationBadge } from "./RentalLeaseClassification";
import RentalStatus from "./RentalStatus";
import type {
  RentalAgreement,
  RentalAgreementLine,
  RentalAgreementRouteData
} from "./types";
import { rentalUnitLabel, useRentalLineActions } from "./useRentalLineActions";

type RentalAgreementLineSummaryProps = {
  rentalAgreement: RentalAgreement;
  line: RentalAgreementLine;
};

/** The top of a unit's page: where the unit is in its rental and what can
 *  happen to it next. */
const RentalAgreementLineSummary = ({
  rentalAgreement,
  line
}: RentalAgreementLineSummaryProps) => {
  const { t } = useLingui();
  const actions = useRentalLineActions(rentalAgreement);
  const state = actions.stateOf(line);
  const hasActions =
    state.canDeliver ||
    state.canReturn ||
    state.canRelease ||
    state.canSell ||
    state.canDelete;
  const routeData = useRouteData<RentalAgreementRouteData>(
    path.to.rentalAgreement(rentalAgreement.id!)
  );
  const documents = rentalLineDocuments(
    line.id,
    routeData?.shipments ?? [],
    routeData?.receipts ?? []
  );

  return (
    <>
      <Card>
        <CardHeader>
          <HStack className="justify-between w-full">
            <CardTitle>{rentalUnitLabel(line)}</CardTitle>
            <HStack spacing={2}>
              {line.lessorClassification && (
                <LeaseClassificationBadge value={line.lessorClassification} />
              )}
              <RentalStatus status={line.status} />
            </HStack>
          </HStack>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border border-t border-border">
            <DetailRow label={t`Fleet Asset`}>
              {line.fixedAssetId ? (
                <Link
                  to={path.to.fixedAsset(line.fixedAssetId)}
                  className="hover:underline"
                >
                  {line.fixedAsset?.fixedAssetId ?? line.fixedAssetId}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label={t`Item`}>
              {line.item?.readableIdWithRevision ?? "—"}
            </DetailRow>
            <DetailRow label={t`Serial Number`}>
              {line.fixedAsset?.serialNumber || "—"}
            </DetailRow>
            <DetailRow label={t`Delivered`}>
              <HStack spacing={2}>
                <DateTime
                  value={line.deliveredAt}
                  variant="date"
                  fallback="—"
                />
                {documents.shipment && (
                  <Link
                    to={path.to.shipment(documents.shipment.id)}
                    className="hover:underline"
                  >
                    {documents.shipment.shipmentId}
                  </Link>
                )}
              </HStack>
            </DetailRow>
            <DetailRow label={t`Returned`}>
              <HStack spacing={2}>
                <DateTime value={line.returnedAt} variant="date" fallback="—" />
                {documents.receipt && (
                  <Link
                    to={path.to.receipt(documents.receipt.id)}
                    className="hover:underline"
                  >
                    {documents.receipt.receiptId}
                  </Link>
                )}
              </HStack>
            </DetailRow>
          </div>
        </CardContent>
        {hasActions && (
          <CardFooter>
            <HStack>
              {state.canDeliver && (
                <Button
                  variant="primary"
                  leftIcon={<LuTruck />}
                  isDisabled={state.deliverDisabled}
                  onClick={() => actions.open("deliver", line)}
                >
                  <Trans>Deliver</Trans>
                </Button>
              )}
              {state.canReturn && (
                <Button
                  variant="primary"
                  leftIcon={<LuUndo2 />}
                  isDisabled={state.returnDisabled}
                  onClick={() => actions.open("return", line)}
                >
                  <Trans>Return</Trans>
                </Button>
              )}
              {state.canRelease && (
                <Button
                  variant="secondary"
                  leftIcon={<LuCircleSlash />}
                  isDisabled={state.releaseDisabled}
                  onClick={() => actions.open("release", line)}
                >
                  <Trans>Release unit</Trans>
                </Button>
              )}
              {state.canSell && (
                <Button
                  variant="secondary"
                  leftIcon={<LuBadgeDollarSign />}
                  isDisabled={state.sellDisabled}
                  onClick={() => actions.open("sell", line)}
                >
                  <Trans>Sell to Customer</Trans>
                </Button>
              )}
              {state.canDelete && (
                <Button
                  variant="secondary"
                  leftIcon={<LuTrash />}
                  isDisabled={state.deleteDisabled}
                  onClick={() => actions.open("delete", line)}
                >
                  <Trans>Remove Unit</Trans>
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

export default RentalAgreementLineSummary;
