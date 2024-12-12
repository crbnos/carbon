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
  LuArrowDownLeft,
  LuCheckCheck,
  LuChevronDown,
  LuEye,
  LuFile,
  LuPanelLeft,
  LuPanelRight,
  LuRefreshCw,
} from "react-icons/lu";

import { usePanels } from "~/components/Layout";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { PurchaseOrder, PurchaseOrderLine } from "../../types";

import PurchaseOrderReleaseModal from "./PurchaseOrderReleaseModal";
import PurchasingStatus from "./PurchasingStatus";
import { usePurchaseOrder } from "./usePurchaseOrder";

const PurchaseOrderHeader = () => {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const { toggleExplorer, toggleProperties } = usePanels();

  const routeData = useRouteData<{
    purchaseOrder: PurchaseOrder;
    lines: PurchaseOrderLine[];
  }>(path.to.purchaseOrder(orderId));

  if (!routeData?.purchaseOrder)
    throw new Error("Failed to load purchase order");

  const permissions = usePermissions();

  const statusFetcher = useFetcher<{}>();
  const { receive, invoice } = usePurchaseOrder();
  const releaseDisclosure = useDisclosure();

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
            <Link to={path.to.purchaseOrderDetails(orderId)}>
              <Heading size="h3" className="flex items-center gap-2">
                <span>{routeData?.purchaseOrder?.purchaseOrderId}</span>
              </Heading>
            </Link>
            <PurchasingStatus status={routeData?.purchaseOrder?.status} />
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
                    href={path.to.file.purchaseOrder(orderId)}
                    rel="noreferrer"
                  >
                    <DropdownMenuIcon icon={<LuFile />} />
                    PDF
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              leftIcon={<LuCheckCheck />}
              variant={
                routeData?.purchaseOrder?.status === "Draft"
                  ? "primary"
                  : "secondary"
              }
              onClick={releaseDisclosure.onOpen}
              isDisabled={routeData?.purchaseOrder?.status !== "Draft"}
            >
              Release
            </Button>
            <Button
              leftIcon={<LuArrowDownLeft />}
              isDisabled={
                !["To Receive", "To Receive and Invoice"].includes(
                  routeData?.purchaseOrder?.status ?? ""
                )
              }
              variant={
                ["To Receive", "To Receive and Invoice"].includes(
                  routeData?.purchaseOrder?.status ?? ""
                )
                  ? "primary"
                  : "secondary"
              }
              onClick={() => {
                receive(routeData?.purchaseOrder);
              }}
            >
              Receive
            </Button>
            {/*
            <Button
              leftIcon={<LuCreditCard />}
              isDisabled={
                !["To Invoice", "To Receive and Invoice"].includes(
                  routeData?.purchaseOrder?.status ?? ""
                )
              }
              variant={
                ["To Invoice", "To Receive and Invoice"].includes(
                  routeData?.purchaseOrder?.status ?? ""
                )
                  ? "primary"
                  : "secondary"
              }
              onClick={() => {
                invoice(routeData?.purchaseOrder);
              }}
            >
              Invoice
            </Button> */}

            <statusFetcher.Form
              method="post"
              action={path.to.purchaseOrderStatus(orderId)}
            >
              <input type="hidden" name="status" value="Draft" />
              <Button
                type="submit"
                variant="secondary"
                leftIcon={<LuRefreshCw />}
                isDisabled={
                  ["Draft", "Cancelled", "Closed", "Completed"].includes(
                    routeData?.purchaseOrder?.status ?? ""
                  ) ||
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

      {releaseDisclosure.isOpen && (
        <PurchaseOrderReleaseModal
          purchaseOrder={routeData?.purchaseOrder}
          onClose={releaseDisclosure.onClose}
        />
      )}
    </>
  );
};

export default PurchaseOrderHeader;
