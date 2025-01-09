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
  useDisclosure,
} from "@carbon/react";

import { Link, useFetcher, useParams } from "@remix-run/react";
import {
  LuCheckCheck,
  LuChevronDown,
  LuCircleCheck,
  LuCircleStop,
  LuEllipsisVertical,
  LuEye,
  LuFile,
  LuGitCompare,
  LuPanelLeft,
  LuPanelRight,
  LuRefreshCw,
} from "react-icons/lu";

import { usePanels } from "~/components/Layout";
import { usePermissions, useRouteData } from "~/hooks";
import type { action as statusAction } from "~/routes/x+/sales-order+/$orderId.status";
import { path } from "~/utils/path";
import type { SalesOrder, SalesOrderLine } from "../../types";

import Confirm from "~/components/Modals/Confirm/Confirm";
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

  const statusFetcher = useFetcher<typeof statusAction>();

  const salesOrderToJobsModal = useDisclosure();
  // const deleteSalesOrderModal = useDisclosure();

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide">
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label="Toggle Explorer"
              icon={<LuPanelLeft />}
              onClick={toggleExplorer}
              variant="ghost"
            />
            <Link to={path.to.salesOrderDetails(orderId)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{routeData?.salesOrder?.salesOrderId}</span>
              </Heading>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="More options"
                  icon={<LuEllipsisVertical />}
                  variant="ghost"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  disabled={
                    routeData?.salesOrder?.status !== "Confirmed" ||
                    !permissions.can("create", "production") ||
                    !!routeData?.salesOrder?.jobs
                  }
                  onClick={salesOrderToJobsModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuGitCompare />} />
                  Convert Lines to Jobs
                </DropdownMenuItem>
                {/* <DropdownMenuItem
                  destructive
                  disabled={
                    !permissions.can("delete", "sales") ||
                    !["Draft", "Needs Approval"].includes(
                      routeData?.salesOrder?.status ?? ""
                    )
                  }
                  onClick={deleteSalesOrderModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  Delete Sales Order
                </DropdownMenuItem> */}
              </DropdownMenuContent>
            </DropdownMenu>
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

            <statusFetcher.Form
              method="post"
              action={path.to.salesOrderStatus(orderId)}
            >
              <input type="hidden" name="status" value="Confirmed" />
              <Button
                isDisabled={
                  !["Draft", "Needs Approval"].includes(
                    routeData?.salesOrder?.status ?? ""
                  ) ||
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

            <statusFetcher.Form
              method="post"
              action={path.to.salesOrderStatus(orderId)}
            >
              <input type="hidden" name="status" value="Completed" />
              <Button
                type="submit"
                variant={
                  ["Completed", "Invoiced"].includes(
                    routeData?.salesOrder?.status ?? ""
                  )
                    ? "primary"
                    : "secondary"
                }
                leftIcon={<LuCircleCheck />}
                isDisabled={
                  [
                    "Draft",
                    "Completed",
                    "Cancelled",
                    "Closed",
                    "Invoiced",
                  ].includes(routeData?.salesOrder?.status ?? "") ||
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

            <statusFetcher.Form
              method="post"
              action={path.to.salesOrderStatus(orderId)}
            >
              <input type="hidden" name="status" value="Cancelled" />
              <Button
                type="submit"
                variant="secondary"
                leftIcon={<LuCircleStop />}
                isDisabled={
                  ["Cancelled", "Closed", "Completed", "Invoiced"].includes(
                    routeData?.salesOrder?.status ?? ""
                  ) ||
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
                  ["Draft"].includes(routeData?.salesOrder?.status ?? "") ||
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

            <IconButton
              aria-label="Toggle Properties"
              icon={<LuPanelRight />}
              onClick={toggleProperties}
              variant="ghost"
            />
          </HStack>
        </HStack>
      </div>
      {salesOrderToJobsModal.isOpen && (
        <Confirm
          title="Convert Lines to Jobs"
          text="Are you sure you want to create jobs for this sales order? This will create jobs for all lines that don't already have jobs."
          confirmText="Create Jobs"
          onCancel={salesOrderToJobsModal.onClose}
          onSubmit={salesOrderToJobsModal.onClose}
          action={path.to.salesOrderLinesToJobs(orderId)}
        />
      )}
    </>
  );
};

export default SalesOrderHeader;
