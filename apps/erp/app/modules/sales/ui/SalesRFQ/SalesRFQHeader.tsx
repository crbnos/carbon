import { useCarbon } from "@carbon/auth";
import { Select, Submit, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useDisclosure,
  useMount,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  LuCircleCheck,
  LuCircleX,
  LuEllipsisVertical,
  LuLoaderCircle,
  LuPanelLeft,
  LuPanelRight,
  LuTrash,
  LuTriangleAlert
} from "react-icons/lu";
import { RiProgress4Line } from "react-icons/ri";
import type { FetcherWithComponents } from "react-router";
import { Link, useFetcher, useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { usePanels } from "~/components/Layout";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { isSalesRfqLocked } from "../../sales.models";
import type { Opportunity, SalesRFQ, SalesRFQLine } from "../../types";
import SalesRFQStatus from "./SalesRFQStatus";

const SalesRFQHeader = () => {
  const { t } = useLingui();
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("rfqId not found");

  const convertToQuoteModal = useDisclosure();
  const requiresCustomerAlert = useDisclosure();
  const noQuoteReasonModal = useDisclosure();
  const deleteRFQModal = useDisclosure();
  const { toggleExplorer, toggleProperties } = usePanels();

  const permissions = usePermissions();

  const routeData = useRouteData<{
    rfqSummary: SalesRFQ;
    lines: SalesRFQLine[];
    opportunity: Opportunity;
  }>(path.to.salesRfq(rfqId));

  const status = routeData?.rfqSummary?.status ?? "Draft";
  const isLocked = isSalesRfqLocked(status);

  const statusFetcher = useFetcher<{}>();

  return (
    <div className="flex flex-shrink-0 items-center justify-between gap-x-4 p-2 bg-card border-b h-[var(--header-height)] overflow-x-auto scrollbar-hide ">
      <HStack className="w-full justify-between">
        <HStack>
          <IconButton
            aria-label={t`Toggle Explorer`}
            icon={<LuPanelLeft />}
            onClick={toggleExplorer}
            variant="ghost"
          />
          <Link to={path.to.salesRfqDetails(rfqId)}>
            <Heading size="h4" className="flex items-center gap-2">
              <span>{routeData?.rfqSummary?.rfqId}</span>
            </Heading>
          </Link>
          <Copy text={routeData?.rfqSummary?.rfqId ?? ""} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`More options`}
                icon={<LuEllipsisVertical />}
                variant="secondary"
                size="sm"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                disabled={
                  routeData?.rfqSummary?.status === "Draft" ||
                  (routeData?.opportunity?.quotes.length ?? 0) > 0 ||
                  statusFetcher.state !== "idle" ||
                  !permissions.can("update", "sales")
                }
                onClick={() => {
                  statusFetcher.submit(
                    { status: "Draft" },
                    {
                      method: "post",
                      action: path.to.salesRfqStatus(rfqId)
                    }
                  );
                }}
              >
                <DropdownMenuIcon icon={<LuLoaderCircle />} />
                <Trans>Reopen</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={
                  isLocked ||
                  !permissions.can("delete", "sales") ||
                  !permissions.is("employee")
                }
                destructive
                onClick={deleteRFQModal.onOpen}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                <Trans>Delete RFQ</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
                <Trans>Ready for Quote</Trans>
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
              <Trans>Ready for Quote</Trans>
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
            <Trans>Quote</Trans>
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
            <Trans>No Quote</Trans>
          </Button>

          <IconButton
            aria-label={t`Toggle Properties`}
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
      {deleteRFQModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteSalesRfq(rfqId)}
          isOpen={deleteRFQModal.isOpen}
          name={routeData?.rfqSummary?.rfqId!}
          text={t`Are you sure you want to delete ${routeData?.rfqSummary
            ?.rfqId!}? This cannot be undone.`}
          onCancel={() => {
            deleteRFQModal.onClose();
          }}
          onSubmit={() => {
            deleteRFQModal.onClose();
          }}
        />
      )}
    </div>
  );
};

export default SalesRFQHeader;

const rfqNoQuoteReasonValidator = z.object({
  status: z.enum(["Closed"]),
  noQuoteReasonId: zfd.text(z.string().optional())
});

function NoQuoteReasonModal({
  fetcher,
  rfqId,
  onClose
}: {
  fetcher: FetcherWithComponents<{}>;
  rfqId: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
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
            <ModalTitle>
              <Trans>No Quote Reason</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>Select a reason for why the quote was not created.</Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <input type="hidden" name="status" value="Closed" />
            <VStack spacing={2}>
              <Select
                name="noQuoteReasonId"
                label={t`No Quote Reason`}
                options={noQuoteReasons}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Save</Trans>
            </Submit>
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
          <ModalTitle>
            <Trans>Cannot convert RFQ to quote</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <Alert variant="destructive">
            <LuTriangleAlert className="h-4 w-4" />
            <AlertTitle>
              <Trans>RFQ has no customer</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                In order to convert this RFQ to a quote, it must be associated
                with a customer.
              </Trans>
            </AlertDescription>
          </Alert>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>
            <Trans>OK</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ConvertToQuoteModal({
  lines,
  rfqId,
  onClose
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
          <ModalTitle>
            <Trans>Convert to Quote</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>Are you sure you want to convert the RFQ to a quote?</Trans>
          </ModalDescription>
        </ModalHeader>

        <ModalBody>
          {requiresCustomer && (
            <Alert variant="destructive">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>RFQ has no customer</Trans>
              </AlertTitle>
              <AlertDescription>
                <Trans>
                  In order to convert this RFQ to a quote, it must have a
                  customer.
                </Trans>
              </AlertDescription>
            </Alert>
          )}
          {requiresPartNumbers && (
            <Alert variant="warning">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>Lines need internal part numbers</Trans>
              </AlertTitle>
              <AlertDescription>
                <Trans>
                  In order to convert this RFQ to a quote, all lines must have
                  an internal part number.
                </Trans>{" "}
                <br />
                <br />
                <Trans>
                  Upon clicking Convert, parts will be created with the
                  following internal part numbers:
                </Trans>
                <ul className="list-disc py-2 pl-4">
                  {linesWithoutItems.map((line) => (
                    <li key={line.id}>
                      {line.customerPartId}
                      {line.customerPartRevision &&
                        `.${line.customerPartRevision}`}
                    </li>
                  ))}
                </ul>
                <br />
                <Trans>
                  If you wish to change the part numbers, please click Cancel
                  and manually assign the parts for each line item before
                  converting.
                </Trans>
              </AlertDescription>
            </Alert>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <fetcher.Form method="post" action={path.to.salesRfqConvert(rfqId)}>
            <Button isDisabled={isLoading} type="submit" isLoading={isLoading}>
              <Trans>Convert</Trans>
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
