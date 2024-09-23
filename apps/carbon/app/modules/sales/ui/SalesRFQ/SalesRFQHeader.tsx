import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  HStack,
  Heading,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useDisclosure,
} from "@carbon/react";

import { Form, Link, useFetcher, useParams } from "@remix-run/react";
import { useEffect } from "react";
import {
  LuAlertTriangle,
  LuRefreshCw,
  LuSend,
  LuXCircle,
} from "react-icons/lu";
import { RiProgress2Line, RiProgress4Line } from "react-icons/ri";
import { Assignee, Copy, useOptimisticAssignment } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { SalesRFQ, SalesRFQLine } from "~/modules/sales";
import { path } from "~/utils/path";
import SalesRFQStatus from "./SalesRFQStatus";

const SalesRFQHeader = () => {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("rfqId not found");

  const convertToQuoteModal = useDisclosure();
  const permissions = usePermissions();

  const routeData = useRouteData<{
    rfqSummary: SalesRFQ;
    lines: SalesRFQLine[];
  }>(path.to.salesRfq(rfqId));

  const optimisticAssignment = useOptimisticAssignment({
    id: rfqId,
    table: "salesRfq",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.rfqSummary?.assignee;

  const status = routeData?.rfqSummary?.status ?? "Draft";

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border">
      <HStack className="w-full justify-between">
        <HStack>
          <Link to={path.to.salesRfqDetails(rfqId)}>
            <Heading size="h2" className="flex items-center gap-1">
              <RiProgress2Line />
              <span>{routeData?.rfqSummary?.rfqId}</span>
            </Heading>
          </Link>
          <Copy text={routeData?.rfqSummary?.rfqId ?? ""} />
          <SalesRFQStatus status={routeData?.rfqSummary?.status} />
        </HStack>
        <HStack>
          <Assignee
            id={rfqId}
            table="salesRfq"
            value={assignee ?? ""}
            className="h-8"
            isReadOnly={!permissions.can("update", "sales")}
          />

          {status === "Draft" && (
            <>
              <Form method="post" action={path.to.salesRfqStatus(rfqId)}>
                <input type="hidden" name="status" value="Ready for Quote" />
                <Button
                  isDisabled={!permissions.can("update", "sales")}
                  leftIcon={<LuRefreshCw />}
                  type="submit"
                >
                  Ready for Quote
                </Button>
              </Form>
            </>
          )}

          {status === "Ready for Quote" && (
            <>
              <Form method="post" action={path.to.salesRfqStatus(rfqId)}>
                <input type="hidden" name="status" value="Closed" />
                <Button
                  isDisabled={!permissions.can("update", "sales")}
                  leftIcon={<LuXCircle />}
                  type="submit"
                  variant="destructive"
                >
                  No Quote
                </Button>
              </Form>
              <Button
                isDisabled={
                  routeData?.lines?.length === 0 ||
                  !permissions.can("create", "sales")
                }
                leftIcon={<RiProgress4Line />}
                type="submit"
                variant="primary"
                onClick={convertToQuoteModal.onOpen}
              >
                Quote
              </Button>
            </>
          )}

          {status === "Quoted" && (
            <Button
              isDisabled={!routeData?.rfqSummary.quoteId}
              leftIcon={<LuSend />}
              variant="primary"
              asChild
            >
              <Link
                to={path.to.quoteDetails(routeData?.rfqSummary.quoteId!)}
                prefetch="intent"
              >
                View Quote
              </Link>
            </Button>
          )}

          {status === "Closed" && (
            <>
              <Form method="post" action={path.to.salesRfqStatus(rfqId)}>
                <input type="hidden" name="status" value="Draft" />
                <Button
                  isDisabled={!permissions.can("update", "sales")}
                  leftIcon={<LuRefreshCw />}
                  type="submit"
                  variant="secondary"
                >
                  Reopen
                </Button>
              </Form>
            </>
          )}

          {/* <IconButton
            aria-label="Previous"
            icon={<LuMoveLeft />}
            variant="secondary"
          />
          <IconButton
            aria-label="Next"
            icon={<LuMoveRight />}
            variant="secondary"
          /> */}
        </HStack>
      </HStack>
      {convertToQuoteModal.isOpen && (
        <ConvertToQuoteModal
          lines={routeData?.lines ?? []}
          rfqId={rfqId}
          onClose={convertToQuoteModal.onClose}
        />
      )}
    </div>
  );
};

export default SalesRFQHeader;

function ConvertToQuoteModal({
  lines,
  rfqId,
  onClose,
}: {
  lines: SalesRFQLine[];
  rfqId: string;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ error: string | null }>();
  const isLoading = fetcher.state !== "idle";
  const linesWithoutItems = lines.filter((line) => !line.itemId);
  const requiresPartNumbers = linesWithoutItems.length > 0;

  useEffect(() => {
    if (fetcher.state === "loading") {
      onClose();
    }
  }, [fetcher.state, onClose]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Convert to Quote</ModalTitle>
          <ModalDescription>
            Are you sure you want to convert the RFQ to a quote?
          </ModalDescription>
        </ModalHeader>

        {requiresPartNumbers && (
          <ModalBody>
            <Alert variant="destructive">
              <LuAlertTriangle className="h-4 w-4" />
              <AlertTitle>Lines need internal part numbers</AlertTitle>
              <AlertDescription>
                In order to convert this RFQ to a quote, all lines must have an
                internal part number.
                <ul className="list-disc py-2 pl-4">
                  {linesWithoutItems.map((line) => (
                    <li key={line.id}>
                      {line.customerPartId}{" "}
                      {line.customerPartRevision &&
                        `Rev. ${line.customerPartRevision}`}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          </ModalBody>
        )}

        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <fetcher.Form method="post" action={path.to.salesRfqConvert(rfqId)}>
            <Button
              isDisabled={isLoading || requiresPartNumbers}
              type="submit"
              isLoading={isLoading}
            >
              Convert
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
