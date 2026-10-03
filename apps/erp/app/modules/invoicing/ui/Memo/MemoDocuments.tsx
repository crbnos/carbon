// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import { LuUndo2 } from "react-icons/lu";
import { Await, useParams } from "react-router";
import { Empty } from "~/components";
import {
  RelatedDocument,
  RelatedDocumentGroup,
  RelatedDocumentSkeleton
} from "~/components/DocumentPage";
import { usePermissions, useRouteData } from "~/hooks";
import PurchaseReturnOrderStatus from "~/modules/purchasing/ui/PurchaseReturnOrders/PurchaseReturnOrderStatus";
import SalesReturnOrderStatus from "~/modules/sales/ui/SalesReturnOrders/SalesReturnOrderStatus";
import { path } from "~/utils/path";
import {
  type SettlementRelatedItems,
  useCounterparty,
  useSettlementRows
} from "../Payment/useSettlementDocuments";

type Memo = Database["public"]["Tables"]["memo"]["Row"];

/**
 * The documents around a memo: who it is with, the return it credits, what
 * it has been applied to, and the journal entry posting wrote.
 */
const MemoDocuments = () => {
  const { memoId } = useParams();
  if (!memoId) throw new Error("memoId not found");

  const routeData = useRouteData<{
    memo: Memo;
    relatedItems?: Promise<SettlementRelatedItems>;
  }>(path.to.memo(memoId));

  const memo = routeData?.memo;
  if (!memo) return null;

  return (
    <Suspense
      fallback={
        <RelatedDocumentGroup>
          <RelatedDocumentSkeleton />
          <RelatedDocumentSkeleton />
        </RelatedDocumentGroup>
      }
    >
      <Await resolve={routeData?.relatedItems}>
        {(related) => <MemoDocumentList memo={memo} related={related} />}
      </Await>
    </Suspense>
  );
};

function MemoDocumentList({
  memo,
  related
}: {
  memo: Memo;
  related?: SettlementRelatedItems;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const party = useCounterparty(memo);
  const settlementRows = useSettlementRows(related);

  const salesReturn =
    related?.salesReturnOrder && permissions.can("view", "sales")
      ? related.salesReturnOrder
      : null;
  const purchaseReturn =
    related?.purchaseReturnOrder && permissions.can("view", "purchasing")
      ? related.purchaseReturnOrder
      : null;

  if (
    !party &&
    !salesReturn &&
    !purchaseReturn &&
    settlementRows.length === 0
  ) {
    return <Empty className="py-12" />;
  }

  return (
    <RelatedDocumentGroup>
      {party && (
        <RelatedDocument
          to={party.to}
          icon={party.icon}
          title={party.name}
          description={party.label}
        />
      )}
      {salesReturn && (
        <RelatedDocument
          to={path.to.salesReturnOrderDetails(salesReturn.id)}
          icon={<LuUndo2 />}
          title={salesReturn.salesReturnOrderId}
          description={t`Sales Return`}
          status={<SalesReturnOrderStatus status={salesReturn.status} />}
        />
      )}
      {purchaseReturn && (
        <RelatedDocument
          to={path.to.purchaseReturnOrderDetails(purchaseReturn.id)}
          icon={<LuUndo2 />}
          title={purchaseReturn.purchaseReturnOrderId}
          description={t`Purchase Return`}
          status={<PurchaseReturnOrderStatus status={purchaseReturn.status} />}
        />
      )}
      {settlementRows}
    </RelatedDocumentGroup>
  );
}

export default MemoDocuments;
