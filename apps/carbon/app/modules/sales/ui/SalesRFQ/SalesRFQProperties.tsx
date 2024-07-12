import {
  Button,
  Enumerable,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
} from "@carbon/react";
import { getLocalTimeZone, parseDate } from "@internationalized/date";
import { useParams } from "@remix-run/react";
import { LuCopy, LuLink } from "react-icons/lu";
import {
  Assignee,
  CustomerAvatar,
  useOptimisticAssignment,
} from "~/components";
import { useRouteData } from "~/hooks";
import type { ModelUpload } from "~/modules/items";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import type { SalesRFQ } from "../../types";
import SalesRFQStatus from "./SalesRFQStatus";

const formatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "full",
  timeZone: getLocalTimeZone(),
});

const SalesRFQProperties = () => {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("rfqId not found");

  const sharedData = useRouteData<{ locations: ListItem[] }>(
    path.to.salesRfqRoot
  );
  const routeData = useRouteData<{
    rfqSummary: SalesRFQ;
    modelUploads?: ModelUpload[];
  }>(path.to.salesRfq(rfqId));

  const locations = sharedData?.locations ?? [];

  const optimisticAssignment = useOptimisticAssignment({
    id: rfqId,
    table: "salesRfq",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.rfqSummary?.assignee;

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto border-l border-border px-4 py-2"
    >
      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Properties</h3>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Link"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    navigator.clipboard.writeText(
                      window.location.origin + path.to.salesRfq(rfqId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to RFQ</span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Copy"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    navigator.clipboard.writeText(
                      routeData?.rfqSummary?.rfqId ?? ""
                    )
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy RFQ number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{routeData?.rfqSummary?.rfqId}</span>
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Assignee</h3>
        <Assignee id={rfqId} table="salesRfq" value={assignee ?? ""} />
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Status</h3>
        <SalesRFQStatus status={routeData?.rfqSummary?.status} />
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Customer</h3>
        <CustomerAvatar
          customerId={routeData?.rfqSummary?.customerId ?? null}
        />
      </VStack>

      {routeData?.rfqSummary?.customerReference && (
        <VStack spacing={2}>
          <h3 className="text-xs text-muted-foreground">
            Customer Reference Number
          </h3>
          <span className="text-sm">
            {routeData.rfqSummary.customerReference}
          </span>
        </VStack>
      )}

      {routeData?.rfqSummary?.rfqDate && (
        <VStack spacing={2}>
          <h3 className="text-xs text-muted-foreground">RFQ Date</h3>
          <span className="text-sm">
            {formatter.format(
              parseDate(routeData.rfqSummary.rfqDate).toDate(getLocalTimeZone())
            )}
          </span>
        </VStack>
      )}

      {routeData?.rfqSummary?.expirationDate && (
        <VStack spacing={2}>
          <h3 className="text-xs text-muted-foreground">Expiration Date</h3>
          <span className="text-sm">
            {formatter.format(
              parseDate(routeData.rfqSummary.expirationDate).toDate(
                getLocalTimeZone()
              )
            )}
          </span>
        </VStack>
      )}

      {routeData?.rfqSummary?.locationId && (
        <VStack spacing={2}>
          <h3 className="text-xs text-muted-foreground">Location</h3>
          <Enumerable
            value={
              locations.find(
                (location) => location.id === routeData?.rfqSummary?.locationId
              )?.name ?? null
            }
          />
        </VStack>
      )}
    </VStack>
  );
};

export default SalesRFQProperties;
