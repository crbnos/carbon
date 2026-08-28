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
import { CustomerAvatar, Hyperlink } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useDateFormatter, useRouteData } from "~/hooks";
import ReceiptStatus from "~/modules/inventory/ui/Receipts/ReceiptStatus";
import MemoStatus from "~/modules/invoicing/ui/Memo/MemoStatus";
import IssueStatus from "~/modules/quality/ui/Issue/IssueStatus";
import {
  getSalesReturnOrderCredits,
  getSalesReturnOrderIssues,
  getSalesReturnOrderReceipts
} from "~/modules/sales";
import SalesReturnOrderStatus from "~/modules/sales/ui/SalesReturnOrders/SalesReturnOrderStatus";
import type {
  SalesReturnOrder,
  SalesReturnOrderLine
} from "~/modules/sales/ui/SalesReturnOrders/types";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [receipts, credits, issues] = await Promise.all([
    getSalesReturnOrderReceipts(client, id, companyId),
    getSalesReturnOrderCredits(client, id, companyId),
    getSalesReturnOrderIssues(client, id, companyId)
  ]);

  return {
    receipts: receipts.data ?? [],
    credits: credits.data ?? [],
    issues: issues.data ?? []
  };
}

export default function SalesReturnOrderDetailsRoute() {
  const { t } = useLingui();
  const { receipts, credits, issues } = useLoaderData<typeof loader>();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    salesReturnOrder: SalesReturnOrder;
    lines: SalesReturnOrderLine[];
  }>(path.to.salesReturnOrder(id));

  const { formatDate } = useDateFormatter();
  const salesReturnOrder = routeData?.salesReturnOrder;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{salesReturnOrder?.salesReturnOrderId}</CardTitle>
        </CardHeader>
        <CardContent>
          <CardAttributes>
            <CardAttribute>
              <CardAttributeLabel>
                <Trans>Customer</Trans>
              </CardAttributeLabel>
              <CardAttributeValue>
                <CustomerAvatar
                  customerId={salesReturnOrder?.customerId ?? null}
                />
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>
                <Trans>Status</Trans>
              </CardAttributeLabel>
              <CardAttributeValue>
                <SalesReturnOrderStatus status={salesReturnOrder?.status} />
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>
                <Trans>Order Date</Trans>
              </CardAttributeLabel>
              <CardAttributeValue>
                {formatDate(salesReturnOrder?.orderDate)}
              </CardAttributeValue>
            </CardAttribute>
            {salesReturnOrder?.expirationDate && (
              <CardAttribute>
                <CardAttributeLabel>
                  <Trans>Expiration Date</Trans>
                </CardAttributeLabel>
                <CardAttributeValue>
                  {formatDate(salesReturnOrder?.expirationDate)}
                </CardAttributeValue>
              </CardAttribute>
            )}
            <CardAttribute>
              <CardAttributeLabel>
                <Trans>Currency</Trans>
              </CardAttributeLabel>
              <CardAttributeValue>
                <Enumerable value={salesReturnOrder?.currencyCode ?? null} />
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
            <Trans>Receipts</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No receipts yet</Trans>
            </p>
          ) : (
            <VStack spacing={2}>
              {receipts.map((receipt) => (
                <HStack key={receipt.id} className="w-full justify-between">
                  <Hyperlink to={path.to.receiptDetails(receipt.id)}>
                    {receipt.receiptId}
                  </Hyperlink>
                  <HStack spacing={4}>
                    <span className="text-sm text-muted-foreground">
                      {formatDate(receipt.postingDate)}
                    </span>
                    <ReceiptStatus status={receipt.status} />
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
