import {
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  Heading,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
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
  toast,
  useDisclosure,
} from "@carbon/react";

import { Link, useFetcher, useParams } from "@remix-run/react";
import {
  LuCheck,
  LuCheckCheck,
  LuChevronDown,
  LuCircleStop,
  LuCircleX,
  LuCopy,
  LuEllipsisVertical,
  LuExternalLink,
  LuEye,
  LuFile,
  LuGitBranchPlus,
  LuLoaderCircle,
  LuPanelLeft,
  LuPanelRight,
  LuShare,
  LuTrophy,
} from "react-icons/lu";
import { usePanels } from "~/components/Layout";

import { useEffect, useState } from "react";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type {
  Opportunity,
  Quotation,
  QuotationLine,
  QuotationPrice,
  QuotationShipment,
} from "../../types";
import QuoteFinalizeModal from "./QuoteFinalizeModal";
import QuoteStatus from "./QuoteStatus";
import QuoteToOrderDrawer from "./QuoteToOrderDrawer";

const QuoteHeader = () => {
  const permissions = usePermissions();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");

  const { toggleExplorer, toggleProperties } = usePanels();

  const routeData = useRouteData<{
    quote: Quotation;
    lines: QuotationLine[];
    opportunity: Opportunity;
    prices: QuotationPrice[];
    shipment: QuotationShipment;
  }>(path.to.quote(quoteId));

  const eligibleLines = routeData?.lines.filter(
    (line) => line.status !== "No Quote"
  );

  const finalizeModal = useDisclosure();
  const convertToOrderModal = useDisclosure();
  const shareModal = useDisclosure();
  const createRevisionModal = useDisclosure();

  const [asRevision, setAsRevision] = useState(false);

  const finalizeFetcher = useFetcher<{}>();
  const statusFetcher = useFetcher<{}>();

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label="Toggle Explorer"
              icon={<LuPanelLeft />}
              onClick={toggleExplorer}
              variant="ghost"
            />
            <Link to={path.to.quoteDetails(quoteId)}>
              <Heading
                size="h4"
                className="flex items-center justify-start gap-0"
              >
                <span>{routeData?.quote?.quoteId}</span>
                {(routeData?.quote?.revisionId ?? 0) > 0 && (
                  <span className="text-muted-foreground">
                    -{routeData?.quote?.revisionId}
                  </span>
                )}
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
                  onClick={() => {
                    setAsRevision(false);
                    createRevisionModal.onOpen();
                  }}
                >
                  <DropdownMenuIcon icon={<LuCopy />} />
                  Copy Quote
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setAsRevision(true);
                    createRevisionModal.onOpen();
                  }}
                >
                  <DropdownMenuIcon icon={<LuGitBranchPlus />} />
                  Create Quote Revision
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <QuoteStatus status={routeData?.quote?.status} />
          </HStack>
          <HStack>
            {routeData?.quote.externalLinkId &&
            routeData?.quote.status === "Sent" ? (
              <Button
                onClick={shareModal.onOpen}
                leftIcon={<LuShare />}
                variant="secondary"
              >
                Share
              </Button>
            ) : (
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
                  {routeData?.quote.externalLinkId && (
                    <DropdownMenuItem asChild>
                      <a
                        target="_blank"
                        href={path.to.externalQuote(
                          routeData.quote.externalLinkId
                        )}
                        rel="noreferrer"
                      >
                        <DropdownMenuIcon icon={<LuExternalLink />} />
                        Digital Quote
                      </a>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem asChild>
                    <a
                      target="_blank"
                      href={path.to.file.quote(quoteId)}
                      rel="noreferrer"
                    >
                      <DropdownMenuIcon icon={<LuFile />} />
                      PDF
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              onClick={finalizeModal.onOpen}
              isLoading={finalizeFetcher.state !== "idle"}
              isDisabled={
                routeData?.quote?.status !== "Draft" ||
                finalizeFetcher.state !== "idle" ||
                !permissions.can("update", "sales") ||
                !eligibleLines?.length
              }
              variant={
                routeData?.quote?.status === "Draft" ? "primary" : "secondary"
              }
              leftIcon={<LuCheckCheck />}
            >
              Finalize
            </Button>

            <Button
              isDisabled={
                routeData?.quote?.status !== "Sent" ||
                !permissions.can("update", "sales")
              }
              leftIcon={<LuTrophy />}
              variant={
                ["Sent", "Ordered", "Partial"].includes(
                  routeData?.quote?.status ?? ""
                )
                  ? "primary"
                  : "secondary"
              }
              onClick={convertToOrderModal.onOpen}
            >
              Won
            </Button>

            <statusFetcher.Form
              method="post"
              action={path.to.quoteStatus(quoteId)}
            >
              <input type="hidden" name="status" value="Lost" />
              <Button
                isDisabled={
                  routeData?.quote?.status !== "Sent" ||
                  statusFetcher.state !== "idle" ||
                  !permissions.can("update", "sales")
                }
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("status") === "Lost"
                }
                leftIcon={<LuCircleX />}
                type="submit"
                variant={
                  ["Sent", "Lost"].includes(routeData?.quote?.status ?? "")
                    ? "destructive"
                    : "secondary"
                }
              >
                Lost
              </Button>
            </statusFetcher.Form>

            {routeData?.quote?.status === "Draft" ? (
              <statusFetcher.Form
                method="post"
                action={path.to.quoteStatus(quoteId)}
              >
                <input type="hidden" name="status" value="Cancelled" />
                <Button
                  isDisabled={
                    statusFetcher.state !== "idle" ||
                    !permissions.can("update", "sales")
                  }
                  isLoading={
                    statusFetcher.state !== "idle" &&
                    statusFetcher.formData?.get("status") === "Cancelled"
                  }
                  leftIcon={<LuCircleStop />}
                  type="submit"
                  variant="secondary"
                >
                  Cancel
                </Button>
              </statusFetcher.Form>
            ) : (
              <statusFetcher.Form
                method="post"
                action={path.to.quoteStatus(quoteId)}
              >
                <input type="hidden" name="status" value="Draft" />
                {routeData?.opportunity?.salesOrders.length === 0 ? (
                  <Button
                    isDisabled={
                      routeData?.opportunity?.salesOrders.length !== 0 ||
                      statusFetcher.state !== "idle" ||
                      !permissions.can("update", "sales")
                    }
                    isLoading={
                      statusFetcher.state !== "idle" &&
                      statusFetcher.formData?.get("status") === "Draft"
                    }
                    leftIcon={<LuLoaderCircle />}
                    type="submit"
                    variant="secondary"
                  >
                    Reopen
                  </Button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger>
                      <Button
                        leftIcon={<LuLoaderCircle />}
                        isDisabled
                        variant="secondary"
                      >
                        Reopen
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Quote is linked to a Sales Order. Delete the sales order
                      to reopen.
                    </TooltipContent>
                  </Tooltip>
                )}
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
      {finalizeModal.isOpen && (
        <QuoteFinalizeModal
          quote={routeData?.quote}
          lines={eligibleLines ?? []}
          pricing={routeData?.prices ?? []}
          shipment={routeData?.shipment ?? null}
          onClose={finalizeModal.onClose}
          fetcher={finalizeFetcher}
        />
      )}
      {createRevisionModal.isOpen && (
        <CreateRevisionModal
          quote={routeData?.quote}
          asRevision={asRevision}
          onClose={createRevisionModal.onClose}
        />
      )}
      {shareModal.isOpen && (
        <ShareQuoteModal
          id={quoteId}
          externalLinkId={routeData?.quote.externalLinkId ?? undefined}
          onClose={shareModal.onClose}
        />
      )}
      {/* we use isOpen so we don't lose state */}
      <QuoteToOrderDrawer
        isOpen={convertToOrderModal.isOpen}
        onClose={convertToOrderModal.onClose}
        quote={routeData?.quote!}
        lines={eligibleLines ?? []}
        pricing={routeData?.prices ?? []}
      />
    </>
  );
};

export default QuoteHeader;

function CreateRevisionModal({
  quote,
  asRevision,
  onClose,
}: {
  quote?: Quotation;
  asRevision: boolean;
  onClose: () => void;
}) {
  const [newQuoteId, setNewQuoteId] = useState<string | null>(null);
  const fetcher = useFetcher<
    | { success: false; message: string }
    | { success: true; data: { newQuoteId: string } }
  >();

  useEffect(() => {
    if (fetcher.data?.success === false) {
      toast.error(fetcher.data?.message);
    }

    if (fetcher.data?.success === true) {
      toast.success(
        asRevision
          ? "Successfully created a new revision"
          : "Successfully copied quote"
      );
      setNewQuoteId(fetcher.data?.data.newQuoteId ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data?.success]);

  if (!quote) return null;
  return (
    <Modal open onOpenChange={onClose}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            {asRevision ? "Create Quote Revision" : "Copy Quote"}
          </ModalTitle>
          <ModalDescription>
            {asRevision
              ? "The quote will be copied with a revision suffix"
              : "Create a quote with a new quote ID"}
          </ModalDescription>
        </ModalHeader>
        {newQuoteId ? (
          <>
            <ModalBody>
              <div className="flex flex-col items-center justify-center py-8">
                <div>
                  <LuCheck className="w-16 h-16 text-green-500" />
                </div>
                <h2 className="animate-fade-in">The quote has been created</h2>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button asChild>
                <Link to={path.to.quoteDetails(newQuoteId)}>Open</Link>
              </Button>
            </ModalFooter>
          </>
        ) : (
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <fetcher.Form
              method="post"
              action={path.to.quoteDuplicate(quote.id!)}
            >
              <input type="hidden" name="quoteId" value={quote?.id ?? ""} />
              <input
                type="hidden"
                name="asRevision"
                value={asRevision ? "true" : "false"}
              />
              <Button
                isLoading={fetcher.state !== "idle"}
                isDisabled={fetcher.state !== "idle"}
                variant="primary"
                type="submit"
              >
                {asRevision ? "Create Revision" : "Copy Quote"}
              </Button>
            </fetcher.Form>
          </ModalFooter>
        )}
      </ModalContent>
    </Modal>
  );
}

function ShareQuoteModal({
  id,
  externalLinkId,
  onClose,
}: {
  id?: string;
  externalLinkId?: string;
  onClose: () => void;
}) {
  if (!externalLinkId) return null;
  if (typeof window === "undefined") return null;

  const digitalQuoteUrl = `${window.location.origin}${path.to.externalQuote(
    externalLinkId
  )}`;
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
          <ModalTitle>Share Quote</ModalTitle>
          <ModalDescription>
            Copy this link to share the quote with a customer
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <InputGroup>
            <Input value={digitalQuoteUrl} />
            <InputRightElement>
              <Copy text={digitalQuoteUrl} />
            </InputRightElement>
          </InputGroup>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
