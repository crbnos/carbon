import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Card,
  CardAttribute,
  CardAttributeLabel,
  CardAttributes,
  CardAttributeValue,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { Hyperlink, SupplierAvatar } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useDateFormatter, useRouteData } from "~/hooks";
import ShipmentStatus from "~/modules/inventory/ui/Shipments/ShipmentStatus";
import MemoStatus from "~/modules/invoicing/ui/Memo/MemoStatus";
import {
  getPurchaseReturnOrderCredits,
  getPurchaseReturnOrderIssues,
  getPurchaseReturnOrderShipments
} from "~/modules/purchasing";
import PurchaseReturnOrderStatus from "~/modules/purchasing/ui/PurchaseReturnOrders/PurchaseReturnOrderStatus";
import type {
  PurchaseReturnOrder,
  PurchaseReturnOrderLine
} from "~/modules/purchasing/ui/PurchaseReturnOrders/types";
import IssueStatus from "~/modules/quality/ui/Issue/IssueStatus";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [shipments, credits, issues] = await Promise.all([
    getPurchaseReturnOrderShipments(client, id, companyId),
    getPurchaseReturnOrderCredits(client, id, companyId),
    getPurchaseReturnOrderIssues(client, id, companyId)
  ]);

  return {
    shipments: shipments.data ?? [],
    credits: credits.data ?? [],
    issues: issues.data ?? []
  };
}

export default function PurchaseReturnOrderDetailsRoute() {
  const { t } = useLingui();
  const { shipments, credits, issues } = useLoaderData<typeof loader>();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    purchaseReturnOrder: PurchaseReturnOrder;
    lines: PurchaseReturnOrderLine[];
  }>(path.to.purchaseReturnOrder(id));

  const { formatDate } = useDateFormatter();
  const purchaseReturnOrder = routeData?.purchaseReturnOrder;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{purchaseReturnOrder?.purchaseReturnOrderId}</CardTitle>
        </CardHeader>
        <CardContent>
          <CardAttributes>
            <CardAttribute>
              <CardAttributeLabel>
                <Trans>Supplier</Trans>
              </CardAttributeLabel>
              <CardAttributeValue>
                <SupplierAvatar
                  supplierId={purchaseReturnOrder?.supplierId ?? null}
                />
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>
                <Trans>Status</Trans>
              </CardAttributeLabel>
              <CardAttributeValue>
                <PurchaseReturnOrderStatus
                  status={purchaseReturnOrder?.status}
                />
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>
                <Trans>Order Date</Trans>
              </CardAttributeLabel>
              <CardAttributeValue>
                {formatDate(purchaseReturnOrder?.orderDate)}
              </CardAttributeValue>
            </CardAttribute>
            {purchaseReturnOrder?.expirationDate && (
              <CardAttribute>
                <CardAttributeLabel>
                  <Trans>Expiration Date</Trans>
                </CardAttributeLabel>
                <CardAttributeValue>
                  {formatDate(purchaseReturnOrder?.expirationDate)}
                </CardAttributeValue>
              </CardAttribute>
            )}
            {purchaseReturnOrder?.supplierReference && (
              <CardAttribute>
                <CardAttributeLabel>
                  <Trans>Supplier RMA #</Trans>
                </CardAttributeLabel>
                <CardAttributeValue>
                  {purchaseReturnOrder?.supplierReference}
                </CardAttributeValue>
              </CardAttribute>
            )}
            <CardAttribute>
              <CardAttributeLabel>
                <Trans>Currency</Trans>
              </CardAttributeLabel>
              <CardAttributeValue>
                <Enumerable value={purchaseReturnOrder?.currencyCode ?? null} />
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>
                <Trans>Lines</Trans>
              </CardAttributeLabel>
              <CardAttributeValue>
                <span className="tabular-nums">
                  {routeData?.lines?.length ?? 0}
                </span>
              </CardAttributeValue>
            </CardAttribute>
          </CardAttributes>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Shipments</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {shipments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No shipments yet</Trans>
            </p>
          ) : (
            <VStack spacing={2}>
              {shipments.map((shipment) => (
                <HStack key={shipment.id} className="w-full justify-between">
                  <Hyperlink to={path.to.shipmentDetails(shipment.id)}>
                    {shipment.shipmentId}
                  </Hyperlink>
                  <HStack spacing={4}>
                    <span className="text-sm text-muted-foreground">
                      {formatDate(shipment.postingDate)}
                    </span>
                    <ShipmentStatus status={shipment.status} />
                  </HStack>
                </HStack>
              ))}
            </VStack>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Credits</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {credits.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No credits yet</Trans>
            </p>
          ) : (
            <VStack spacing={2}>
              {credits.map((credit) => (
                <HStack key={credit.id} className="w-full justify-between">
                  <Hyperlink to={path.to.memo(credit.id)}>
                    {credit.memoId}
                  </Hyperlink>
                  <HStack spacing={4}>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {credit.amount} {credit.currencyCode}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {formatDate(credit.memoDate)}
                    </span>
                    <MemoStatus status={credit.status} />
                  </HStack>
                </HStack>
              ))}
            </VStack>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Issues</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No issues yet</Trans>
            </p>
          ) : (
            <VStack spacing={2}>
              {issues.map((issue) => (
                <HStack key={issue.id} className="w-full justify-between">
                  {issue.nonConformance ? (
                    <Hyperlink to={path.to.issue(issue.nonConformance.id)}>
                      {issue.nonConformance.nonConformanceId}
                    </Hyperlink>
                  ) : (
                    <span className="text-sm">{t`Issue`}</span>
                  )}
                  <HStack spacing={4}>
                    <span className="text-sm text-muted-foreground truncate">
                      {issue.nonConformance?.name}
                    </span>
                    <IssueStatus status={issue.nonConformance?.status} />
                  </HStack>
                </HStack>
              ))}
            </VStack>
          )}
        </CardContent>
      </Card>
    </>
  );
}
