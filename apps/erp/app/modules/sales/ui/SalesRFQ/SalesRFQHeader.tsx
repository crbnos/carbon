import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  HStack,
  Heading,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
  useDisclosure,
  useMount,
} from "@carbon/react";

import { useCarbon } from "@carbon/auth";
import { Select, Submit, ValidatedForm } from "@carbon/form";
import type { FetcherWithComponents } from "@remix-run/react";
import { Link, useFetcher, useParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  LuCircleCheck,
  LuCircleX,
  LuPanelLeft,
  LuPanelRight,
  LuRefreshCw,
  LuTriangleAlert,
} from "react-icons/lu";
import { RiProgress4Line } from "react-icons/ri";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { usePanels } from "~/components/Layout";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import type { Opportunity, SalesRFQ, SalesRFQLine } from "../../types";
import SalesRFQStatus from "./SalesRFQStatus";

const SalesRFQHeader = () => {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("rfqId not found");

  const convertToQuoteModal = useDisclosure();
  const requiresCustomerAlert = useDisclosure();
  const noQuoteReasonModal = useDisclosure();
  const { toggleExplorer, toggleProperties } = usePanels();

  const permissions = usePermissions();

  const routeData = useRouteData<{
    rfqSummary: SalesRFQ;
    lines: SalesRFQLine[];
    opportunity: Opportunity;
  }>(path.to.salesRfq(rfqId));

  const status = routeData?.rfqSummary?.status ?? "Draft";

  const statusFetcher = useFetcher<{}>();

  return (
    <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08),_0px_0px_10px_rgba(0,_0,_0,_0.12),_0px_0px_24px_rgba(0,_0,_0,_0.16),_0px_0px_80px_rgba(0,_0,_0,_0.2)] ">
      <HStack className="w-full justify-between">
        <HStack>
          <IconButton
            aria-label="Toggle Explorer"
            icon={<LuPanelLeft />}
            onClick={toggleExplorer}
            variant="ghost"
          />
          <Link to={path.to.salesRfqDetails(rfqId)}>
            <Heading size="h4" className="flex items-center gap-2">
              <span>{routeData?.rfqSummary?.rfqId}</span>
            </Heading>
          </Link>
          <SalesRFQStatus status={routeData?.rfqSummary?.status} />
        </HStack>
        <HStack>
          {routeData?.rfqSummary?.customerId ? (
            <statusFetcher.Form
              method="post"
              action={path.to.salesRfqStatus(rfqId)}
            >
              <input type="hidden" name="status" value="Ready for Quote" />
              <Button
                isDisabled={
                  status !== "Draft" ||
                  routeData?.lines?.length === 0 ||
                  !permissions.can("update", "sales")
                }
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("status") === "Ready for Quote"
                }
                leftIcon={<LuCircleCheck />}
                variant={status === "Draft" ? "primary" : "secondary"}
                type="submit"
              >
                Ready for Quote
              </Button>
            </statusFetcher.Form>
          ) : (
            <Button
              isDisabled={
                status !== "Ready for Quote" ||
                routeData?.lines?.length === 0 ||
                !permissions.can("update", "sales")
              }
              leftIcon={<LuCircleCheck />}
              variant={status === "Draft" ? "primary" : "secondary"}
              onClick={requiresCustomerAlert.onOpen}
            >
              Ready for Quote
            </Button>
          )}

          <Button
            isDisabled={
              status !== "Ready for Quote" ||
              routeData?.lines?.length === 0 ||
              !permissions.can("create", "sales")
            }
            leftIcon={<RiProgress4Line />}
            type="submit"
            variant={
              ["Ready for Quote", "Quoted"].includes(status)
                ? "primary"
                : "secondary"
            }
            onClick={convertToQuoteModal.onOpen}
          >
            Quote
          </Button>
          {/* <statusFetcher.Form
            method="post"
            action={path.to.salesRfqStatus(rfqId)}
          >
            <input type="hidden" name="status" value="Closed" />
            <Button
              isDisabled={
                status !== "Ready for Quote" ||
                statusFetcher.state !== "idle" ||
                !permissions.can("update", "sales")
              }
              isLoading={
                statusFetcher.state !== "idle" &&
                statusFetcher.formData?.get("status") === "Closed"
              }
              leftIcon={<LuCircleX />}
              type="submit"
              variant={
                ["Ready for Quote", "Closed"].includes(status)
                  ? "destructive"
                  : "secondary"
              }
            >
              No Quote
            </Button>
          </statusFetcher.Form> */}
          <Button
            onClick={noQuoteReasonModal.onOpen}
            isDisabled={
              status !== "Ready for Quote" ||
              statusFetcher.state !== "idle" ||
              !permissions.can("update", "sales")
            }
            isLoading={
              statusFetcher.state !== "idle" &&
              statusFetcher.formData?.get("status") === "Closed"
            }
            leftIcon={<LuCircleX />}
            variant={
              ["Ready for Quote", "Closed"].includes(status)
                ? "destructive"
                : "secondary"
            }
          >
            No Quote
          </Button>

          <statusFetcher.Form
            method="post"
            action={path.to.salesRfqStatus(rfqId)}
          >
            <input type="hidden" name="status" value="Draft" />
            {routeData?.opportunity?.quoteId === null ? (
              <Button
                isDisabled={
                  !["Ready for Quote", "Closed", "Quoted"].includes(status) ||
                  statusFetcher.state !== "idle" ||
                  !permissions.can("update", "sales")
                }
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("status") === "Draft"
                }
                leftIcon={<LuRefreshCw />}
                type="submit"
                variant="secondary"
              >
                Reopen
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    leftIcon={<LuRefreshCw />}
                    isDisabled
                    variant="secondary"
                  >
                    Reopen
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  RFQ is linked to a Quote. Delete the quote to reopen.
                </TooltipContent>
              </Tooltip>
            )}
          </statusFetcher.Form>

          <IconButton
            aria-label="Toggle Properties"
            icon={<LuPanelRight />}
            onClick={toggleProperties}
            variant="ghost"
          />
        </HStack>
      </HStack>
      {convertToQuoteModal.isOpen && (
        <ConvertToQuoteModal
          lines={routeData?.lines ?? []}
          rfqId={rfqId}
          onClose={convertToQuoteModal.onClose}
        />
      )}
      {requiresCustomerAlert.isOpen && (
        <RequiresCustomerAlert onClose={requiresCustomerAlert.onClose} />
      )}
      {noQuoteReasonModal.isOpen && (
        <NoQuoteReasonModal
          fetcher={statusFetcher}
          rfqId={rfqId}
          onClose={noQuoteReasonModal.onClose}
        />
      )}
    </div>
  );
};

export default SalesRFQHeader;

const rfqNoQuoteReasonValidator = z.object({
  status: z.enum(["Closed"]),
  noQuoteReasonId: zfd.text(z.string().optional()),
});

function NoQuoteReasonModal({
  fetcher,
  rfqId,
  onClose,
}: {
  fetcher: FetcherWithComponents<{}>;
  rfqId: string;
  onClose: () => void;
}) {
  const user = useUser();
  const [noQuoteReasons, setNoQuoteReasons] = useState<
    {
      label: string;
      value: string;
    }[]
  >([]);
  const { carbon } = useCarbon();
  const fetchReasons = async () => {
    if (!carbon) return;
    const { data } = await carbon
      .from("noQuoteReason")
      .select("*")
      .eq("companyId", user.company.id);

    setNoQuoteReasons(
      data?.map((reason) => ({ label: reason.name, value: reason.id })) ?? []
    );
  };

  useMount(() => {
    fetchReasons();
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.salesRfqStatus(rfqId)}
          validator={rfqNoQuoteReasonValidator}
          fetcher={fetcher}
          onSubmit={() => {
            onClose();
          }}
        >
          <ModalHeader>
            <ModalTitle>No Quote Reason</ModalTitle>
            <ModalDescription>
              Select a reason for why the quote was not created.
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <input type="hidden" name="status" value="Closed" />
            <VStack spacing={2}>
              <Select
                name="noQuoteReasonId"
                label="No Quote Reason"
                options={noQuoteReasons}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Submit withBlocker={false}>Save</Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

function RequiresCustomerAlert({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Cannot convert RFQ to quote</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <Alert variant="destructive">
            <LuTriangleAlert className="h-4 w-4" />
            <AlertTitle>RFQ has no customer</AlertTitle>
            <AlertDescription>
              In order to convert this RFQ to a quote, it must be associated
              with a customer.
            </AlertDescription>
          </Alert>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>OK</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ConvertToQuoteModal({
  lines,
  rfqId,
  onClose,
}: {
  lines: SalesRFQLine[];
  rfqId: string;
  onClose: () => void;
}) {
  const routeData = useRouteData<{ rfqSummary: SalesRFQ }>(
    path.to.salesRfq(rfqId)
  );

  const fetcher = useFetcher<{ error: string | null }>();
  const isLoading = fetcher.state !== "idle";
  const linesWithoutItems = lines.filter((line) => !line.itemId);
  const requiresPartNumbers = linesWithoutItems.length > 0;
  const requiresCustomer = !routeData?.rfqSummary?.customerId;

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

        <ModalBody>
          {requiresCustomer && (
            <Alert variant="destructive">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>RFQ has no customer</AlertTitle>
              <AlertDescription>
                In order to convert this RFQ to a quote, it must have a
                customer.
              </AlertDescription>
            </Alert>
          )}
          {requiresPartNumbers && (
            <Alert variant="warning">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>Lines need internal part numbers</AlertTitle>
              <AlertDescription>
                In order to convert this RFQ to a quote, all lines must have an
                internal part number. <br />
                <br />
                Upon clicking Convert, parts will be created with the following
                internal part numbers:
                <ul className="list-disc py-2 pl-4">
                  {linesWithoutItems.map((line) => (
                    <li key={line.id}>
                      {line.customerPartId}
                      {line.customerPartRevision &&
                        `-${line.customerPartRevision}`}
                    </li>
                  ))}
                </ul>
                <br />
                If you wish to change the part numbers, please click Cancel and
                manually assign the parts for each line item before converting.
              </AlertDescription>
            </Alert>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <fetcher.Form method="post" action={path.to.salesRfqConvert(rfqId)}>
            <Button isDisabled={isLoading} type="submit" isLoading={isLoading}>
              Convert
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
