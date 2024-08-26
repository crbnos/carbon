import { Button, HStack, Menubar } from "@carbon/react";
import { Link, useParams } from "@remix-run/react";
import { RiProgress4Line } from "react-icons/ri";
import { BreadcrumbItem, Breadcrumbs } from "~/components";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { SalesOrder, SalesOrderLine } from "../../types";

const SalesOrderBreadcrumbs = () => {
  const { orderId, lineId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const routeData = useRouteData<{
    salesOrder: SalesOrder;
    lines: SalesOrderLine[];
  }>(path.to.salesOrder(orderId));
  const line = routeData?.lines.find((line) => line.id === lineId);

  return (
    <Menubar>
      <HStack className="w-full justify-between">
        <Breadcrumbs>
          <BreadcrumbItem>
            <Button leftIcon={<RiProgress4Line />} variant="ghost" asChild>
              <Link to={path.to.salesOrderDetails(orderId)}>
                {routeData?.salesOrder?.salesOrderId}
              </Link>
            </Button>
          </BreadcrumbItem>
          {line && (
            <BreadcrumbItem>
              <Button variant="ghost" asChild>
                <Link to={path.to.salesOrderLine(orderId, line.id!)}>
                  {line.itemReadableId}
                </Link>
              </Button>
            </BreadcrumbItem>
          )}
        </Breadcrumbs>
      </HStack>
    </Menubar>
  );
};

export default SalesOrderBreadcrumbs;
