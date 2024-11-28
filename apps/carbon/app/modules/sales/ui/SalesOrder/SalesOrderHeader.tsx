import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  Heading,
  IconButton,
} from "@carbon/react";

import { Link, useFetcher, useParams } from "@remix-run/react";
import {
  LuCheckCheck,
  LuCheckCircle,
  LuChevronDown,
  LuEye,
  LuFile,
  LuPanelLeft,
  LuPanelRight,
  LuRefreshCw,
  LuStopCircle,
} from "react-icons/lu";

import { usePanels } from "~/components/Layout";
import { usePermissions, useRouteData } from "~/hooks";
import type { SalesOrder, SalesOrderLine } from "~/modules/sales";
import { path } from "~/utils/path";

import SalesStatus from "./SalesStatus";

const SalesOrderHeader = () => {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const { toggleExplorer, toggleProperties } = usePanels();

  const routeData = useRouteData<{
    salesOrder: SalesOrder;
    lines: SalesOrderLine[];
  }>(path.to.salesOrder(orderId));

  const permissions = usePermissions();

  const statusFetcher = useFetcher<{}>();

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b border-border h-[50px]">
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label="Toggle Explorer"
              icon={<LuPanelLeft />}
              onClick={toggleExplorer}
              variant="ghost"
            />
            <Link to={path.to.salesOrderDetails(orderId)}>
              <Heading size="h3" className="flex items-center gap-2">
                <span>{routeData?.salesOrder?.salesOrderId}</span>
              </Heading>
            </Link>
            <SalesStatus status={routeData?.salesOrder?.status} />
          </HStack>
          <HStack>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  leftIcon={<LuEye />}
                  variant="secondary"
                  rightIcon={<LuChevronDown />}
                >
                  Preview
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem asChild>
                  <a
                    target="_blank"
                    href={path.to.file.salesOrder(orderId)}
                    rel="noreferrer"
                  >
                    <DropdownMenuIcon icon={<LuFile />} />
                    PDF
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

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
            {!["Draft", "Completed"].includes(
              routeData?.salesOrder?.status ?? ""
            ) && (
              <>
                {/* <Button variant="secondary" isDisabled leftIcon={<LuTruck />}>
                  Ship
                </Button>

                <Button variant="secondary" isDisabled leftIcon={<LuFile />}>
                  Invoice
                </Button> */}
                <statusFetcher.Form
                  method="post"
                  action={path.to.salesOrderStatus(orderId)}
                >
                  <input type="hidden" name="status" value="Completed" />
                  <Button
                    type="submit"
                    variant="secondary"
                    leftIcon={<LuCheckCircle />}
                    isDisabled={
                      statusFetcher.state !== "idle" ||
                      !permissions.can("update", "sales")
                    }
                    isLoading={
                      statusFetcher.state !== "idle" &&
                      statusFetcher.formData?.get("status") === "Completed"
                    }
                  >
                    Complete
                  </Button>
                </statusFetcher.Form>
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

            {["Cancelled", "Closed", "Completed"].includes(
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
            <IconButton
              aria-label="Toggle Properties"
              icon={<LuPanelRight />}
              onClick={toggleProperties}
              variant="ghost"
            />
          </HStack>
        </HStack>
      </div>
    </>
  );
};

export default SalesOrderHeader;
