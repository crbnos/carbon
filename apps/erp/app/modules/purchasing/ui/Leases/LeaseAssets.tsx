// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCircleStop, LuEllipsisVertical, LuHandCoins } from "react-icons/lu";
import { Link } from "react-router";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { LesseeClassificationBadge } from "./LeaseClassificationPreview";
import LeaseMoney from "./LeaseMoney";
import LeasePurchaseModal from "./LeasePurchaseModal";
import LeaseStatus from "./LeaseStatus";
import LeaseTerminateModal from "./LeaseTerminateModal";
import type { LeaseLine, LeaseRouteData } from "./types";
import { isScheduleLinePosted } from "./utils";

type LeaseAssetsProps = Pick<
  LeaseRouteData,
  "lease" | "lines" | "payments" | "schedule" | "fixedAssets"
>;

type AssetAction = { kind: "terminate" | "purchase"; line: LeaseLine };

/** The lease's assets: each one's status, treatment, payment and liability
 *  as of its last posted month, and the fixed asset a purchase made. An
 *  active asset of an Active lease is terminated or purchased here, on its
 *  own; the lease ends with its last asset. */
const LeaseAssets = ({
  lease,
  lines,
  payments,
  schedule,
  fixedAssets
}: LeaseAssetsProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [action, setAction] = useState<AssetAction | null>(null);

  const currencyCode = lease.currencyCode;
  const canChange =
    lease.status === "Active" && permissions.can("update", "purchasing");

  /** The asset's liability after its last posted month: 0 once it ended or
   *  for a short-term asset, which is never on the balance sheet. */
  const liabilityOf = (line: LeaseLine) => {
    if (
      line.status !== "Active" ||
      !line.lesseeClassification ||
      line.lesseeClassification === "Short-Term"
    ) {
      return null;
    }
    let last: (typeof schedule)[number] | undefined;
    for (const row of schedule) {
      if (row.leaseLineId !== line.id) continue;
      if (!isScheduleLinePosted(row)) break;
      last = row;
    }
    return last
      ? Number(last.closingLiability)
      : Number(line.initialLiability ?? 0);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Assets</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Each asset is accounted for on its own. Terminate or purchase one
            here; the others do not change.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <Thead>
            <Tr>
              <Th>
                <Trans>Asset</Trans>
              </Th>
              <Th>
                <Trans>Status</Trans>
              </Th>
              <Th>
                <Trans>Treatment</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Payment</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Lease Liability</Trans>
              </Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {lines.map((line) => {
              const liability = liabilityOf(line);
              const fixedAsset = line.fixedAssetId
                ? fixedAssets[line.fixedAssetId]
                : undefined;
              const isActive = line.status === "Active";
              const canPurchase =
                isActive &&
                !!lease.endDate &&
                Number(line.purchaseOptionAmount ?? 0) > 0 &&
                line.lesseeClassification !== "Short-Term";
              return (
                <Tr key={line.id}>
                  <Td>
                    <div className="flex flex-col">
                      <span className="font-medium whitespace-nowrap">
                        {line.description}
                      </span>
                      {line.serialNumber && (
                        <span className="text-xs text-muted-foreground">
                          {line.serialNumber}
                        </span>
                      )}
                      {fixedAsset && (
                        <Link
                          to={path.to.fixedAsset(fixedAsset.id)}
                          className="text-xs hover:underline"
                        >
                          {fixedAsset.fixedAssetId ?? fixedAsset.name}
                        </Link>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <LeaseStatus
                      status={lease.status === "Draft" ? "Draft" : line.status}
                    />
                  </Td>
                  <Td>
                    {line.lesseeClassification ? (
                      <LesseeClassificationBadge
                        value={line.lesseeClassification}
                      />
                    ) : (
                      <span className="text-muted-foreground">
                        <Trans>Set at activation</Trans>
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <LeaseMoney
                      value={line.paymentAmount}
                      currencyCode={currencyCode}
                    />
                  </Td>
                  <Td className="text-right">
                    {liability === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <LeaseMoney
                        value={liability}
                        currencyCode={currencyCode}
                      />
                    )}
                  </Td>
                  <Td className="text-right">
                    {canChange && isActive && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            aria-label={t`Asset actions`}
                            icon={<LuEllipsisVertical />}
                            variant="ghost"
                            size="sm"
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              setAction({ kind: "terminate", line })
                            }
                          >
                            <DropdownMenuIcon icon={<LuCircleStop />} />
                            <Trans>Terminate</Trans>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!canPurchase}
                            onClick={() =>
                              setAction({ kind: "purchase", line })
                            }
                          >
                            <DropdownMenuIcon icon={<LuHandCoins />} />
                            <Trans>Exercise Purchase Option</Trans>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </CardContent>

      {action?.kind === "terminate" && (
        <LeaseTerminateModal
          lease={lease}
          line={action.line}
          payments={payments}
          schedule={schedule}
          onClose={() => setAction(null)}
        />
      )}
      {action?.kind === "purchase" && (
        <LeasePurchaseModal
          lease={lease}
          line={action.line}
          payments={payments}
          schedule={schedule}
          onClose={() => setAction(null)}
        />
      )}
    </Card>
  );
};

export default LeaseAssets;
