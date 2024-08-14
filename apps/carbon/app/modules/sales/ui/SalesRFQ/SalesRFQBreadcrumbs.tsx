import { Button, HStack, Menubar } from "@carbon/react";
import { Link, useParams } from "@remix-run/react";
import { RiProgress4Line } from "react-icons/ri";
import { BreadcrumbItem, Breadcrumbs } from "~/components";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { SalesRFQ, SalesRFQLine } from "../../types";

const SalesRFQBreadcrumbs = () => {
  const { rfqId, lineId } = useParams();
  if (!rfqId) throw new Error("rfqId not found");

  const routeData = useRouteData<{
    rfqSummary: SalesRFQ;
    lines: SalesRFQLine[];
  }>(path.to.salesRfq(rfqId));

  const line = routeData?.lines.find((line) => line.id === lineId);

  return (
    <>
      <Menubar>
        <HStack className="w-full justify-start">
          <Breadcrumbs>
            <BreadcrumbItem>
              <Button leftIcon={<RiProgress4Line />} variant="ghost" asChild>
                <Link to={path.to.salesRfqDetails(rfqId)}>
                  {routeData?.rfqSummary?.rfqId}
                </Link>
              </Button>
            </BreadcrumbItem>
            {line && (
              <BreadcrumbItem>
                <Button variant="ghost" asChild>
                  <Link to={path.to.salesRfqLine(rfqId, line.id!)}>
                    {line.customerPartId}
                  </Link>
                </Button>
              </BreadcrumbItem>
            )}
          </Breadcrumbs>
        </HStack>
      </Menubar>
    </>
  );
};

export default SalesRFQBreadcrumbs;
