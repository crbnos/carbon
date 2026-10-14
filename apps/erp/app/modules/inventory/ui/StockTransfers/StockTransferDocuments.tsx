// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { LuBarcode } from "react-icons/lu";
import { useParams } from "react-router";
import { Empty } from "~/components";
import {
  RelatedDocument,
  RelatedDocumentGroup
} from "~/components/DocumentPage";
import { useRouteData } from "~/hooks";
import type { StockTransfer, StockTransferLine } from "~/modules/inventory";
import { path } from "~/utils/path";

/**
 * The documents around a stock transfer. It moves stock between storage units
 * of one location, with no counterparty or source document, so what it has is
 * its own pick list.
 */
const StockTransferDocuments = () => {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    stockTransfer: StockTransfer;
    stockTransferLines: StockTransferLine[];
  }>(path.to.stockTransfer(id));

  // A pick list lists the transfer's lines; with none there is nothing to
  // print.
  const hasLines = (routeData?.stockTransferLines ?? []).length > 0;

  if (!routeData?.stockTransfer || !hasLines) {
    return <Empty className="py-12" />;
  }

  return (
    <RelatedDocumentGroup>
      <RelatedDocument
        to={path.to.file.stockTransfer(id)}
        external
        icon={<LuBarcode />}
        title={t`Pick List`}
        description={t`PDF`}
      />
    </RelatedDocumentGroup>
  );
};

export default StockTransferDocuments;
