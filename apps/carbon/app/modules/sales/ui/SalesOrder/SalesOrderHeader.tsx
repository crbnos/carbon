import { Button, HStack, Heading } from "@carbon/react";

import { Link, useFetcher, useParams } from "@remix-run/react";
import {
  LuCheckCheck,
  LuEye,
  LuFile,
  LuRefreshCw,
  LuStopCircle,
  LuTruck,
} from "react-icons/lu";
import { Assignee, useOptimisticAssignment } from "~/components";

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

  const statusFetcher = useFetcher<{}>();

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border">
        <HStack className="w-full justify-between">
          <HStack>
            <Link to={path.to.salesOrderDetails(orderId)}>
              <Heading size="h3" className="flex items-center gap-2">
                <span>{routeData?.salesOrder?.salesOrderId}</span>
              </Heading>
            </Link>
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
            {(routeData?.salesOrder?.status === "Draft" ||
              routeData?.salesOrder?.status === "Needs Approval") && (
              <>
                <statusFetcher.Form
                  method="post"
                  action={path.to.salesOrderStatus(orderId)}
                >
                  <input type="hidden" name="status" value="Confirmed" />
                  <Button
                    isDisabled={
                      statusFetcher.state !== "idle" ||
                      !permissions.can("update", "sales")
                    }
                    isLoading={
                      statusFetcher.state !== "idle" &&
                      statusFetcher.formData?.get("status") === "Confirmed"
                    }
                    leftIcon={<LuCheckCheck />}
                    type="submit"
                    variant="secondary"
                  >
                    Confirm
                  </Button>
                </statusFetcher.Form>
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
            {!["Cancelled", "Closed", "Completed", "Invoiced"].includes(
              routeData?.salesOrder?.status ?? ""
            ) && (
              <statusFetcher.Form
                method="post"
                action={path.to.salesOrderStatus(orderId)}
              >
                <input type="hidden" name="status" value="Cancelled" />
                <Button
                  type="submit"
                  variant="secondary"
                  leftIcon={<LuStopCircle />}
                  isDisabled={
                    statusFetcher.state !== "idle" ||
                    !permissions.can("update", "sales")
                  }
                  isLoading={
                    statusFetcher.state !== "idle" &&
                    statusFetcher.formData?.get("status") === "Cancelled"
                  }
                >
                  Cancel
                </Button>
              </statusFetcher.Form>
            )}

            {["Cancelled", "Closed"].includes(
              routeData?.salesOrder?.status ?? ""
            ) && (
              <statusFetcher.Form
                method="post"
                action={path.to.salesOrderStatus(orderId)}
              >
                <input type="hidden" name="status" value="Draft" />
                <Button
                  type="submit"
                  variant="secondary"
                  leftIcon={<LuRefreshCw />}
                  isDisabled={
                    statusFetcher.state !== "idle" ||
                    !permissions.can("update", "sales")
                  }
                  isLoading={
                    statusFetcher.state !== "idle" &&
                    statusFetcher.formData?.get("status") === "Draft"
                  }
                >
                  Reopen
                </Button>
              </statusFetcher.Form>
            )}
          </HStack>
        </HStack>
      </div>
    </>
  );
};

export default SalesOrderHeader;
