import { Button, HStack, Heading } from "@carbon/react";

import { Form, Link, useParams } from "@remix-run/react";
import {
  LuCheckCheck,
  LuEye,
  LuFile,
  LuTruck,
  LuXCircle,
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Assignee, Copy, useOptimisticAssignment } from "~/components";

import { usePermissions, useRouteData } from "~/hooks";
import type { SalesOrder, SalesOrderLine } from "~/modules/sales";
import { path } from "~/utils/path";

import SalesStatus from "./SalesStatus";

const SalesOrderHeader = () => {
  const permissions = usePermissions();
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const routeData = useRouteData<{
    salesOrder: SalesOrder;
    lines: SalesOrderLine[];
  }>(path.to.salesOrder(orderId));

  const optimisticAssignment = useOptimisticAssignment({
    id: orderId,
    table: "salesOrder",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.salesOrder?.assignee;

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border">
        <HStack className="w-full justify-between">
          <HStack>
            <Link to={path.to.salesOrderDetails(orderId)}>
              <Heading size="h2" className="flex items-center gap-1">
                <RiProgress8Line className="text-primary" />
                <span>{routeData?.salesOrder?.salesOrderId}</span>
              </Heading>
            </Link>
            <Copy text={routeData?.salesOrder?.salesOrderId ?? ""} />
            <SalesStatus status={routeData?.salesOrder?.status} />
          </HStack>
          <HStack>
            <Assignee
              id={orderId}
              table="salesOrder"
              value={assignee ?? ""}
              className="h-8"
              isReadOnly={!permissions.can("update", "sales")}
            />
            <Button leftIcon={<LuEye />} variant="secondary" asChild>
              <a
                target="_blank"
                href={path.to.file.salesOrder(orderId)}
                rel="noreferrer"
              >
                Preview
              </a>
            </Button>
            {routeData?.salesOrder?.status === "Draft" && (
              <>
                <Form method="post" action={path.to.salesOrderStatus(orderId)}>
                  <input type="hidden" name="status" value="Confirmed" />
                  <Button
                    isDisabled={!permissions.can("update", "sales")}
                    leftIcon={<LuCheckCheck />}
                    type="submit"
                    variant="secondary"
                  >
                    Confirm
                  </Button>
                </Form>
              </>
            )}
            {routeData?.salesOrder?.status !== "Draft" && (
              <>
                <Button variant="secondary" isDisabled leftIcon={<LuTruck />}>
                  Ship
                </Button>

                <Button variant="secondary" isDisabled leftIcon={<LuFile />}>
                  Invoice
                </Button>
              </>
            )}

            <Button variant="secondary" isDisabled leftIcon={<LuXCircle />}>
              Cancel
            </Button>
          </HStack>
        </HStack>
      </div>
    </>
  );
};

export default SalesOrderHeader;
