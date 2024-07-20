import { Button } from "@carbon/react";
import { Link, useParams } from "@remix-run/react";
import { RiProgress4Line } from "react-icons/ri";
import { BreadcrumbItem, Breadcrumbs } from "~/components";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Quotation, QuotationLine } from "../../types";

const QuoteBreadcrumbs = () => {
  const { quoteId, lineId, makeMethodId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");

  const routeData = useRouteData<{ quote: Quotation; lines: QuotationLine[] }>(
    path.to.quote(quoteId)
  );
  const line = routeData?.lines.find((line) => line.id === lineId);

  return (
    <Breadcrumbs className="my-1">
      <BreadcrumbItem>
        <Button leftIcon={<RiProgress4Line />} variant="ghost" asChild>
          <Link to={path.to.quoteDetails(quoteId)}>
            {routeData?.quote?.quoteId}
          </Link>
        </Button>
      </BreadcrumbItem>
      {line && (
        <BreadcrumbItem>
          <Button variant="ghost" asChild>
            <Link to={path.to.quoteLine(quoteId, line.id!)}>
              {line.itemReadableId}
            </Link>
          </Button>
        </BreadcrumbItem>
      )}
    </Breadcrumbs>
  );
};

export default QuoteBreadcrumbs;
