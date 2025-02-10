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
  useDisclosure,
} from "@carbon/react";

import { Link, useFetcher, useParams } from "@remix-run/react";
import {
  LuCheckCheck,
  LuChevronDown,
  LuCircleStop,
  LuCircleX,
  LuExternalLink,
  LuEye,
  LuFile,
  LuPanelLeft,
  LuPanelRight,
  LuRefreshCw,
  LuShare,
  LuTrophy,
} from "react-icons/lu";
import { Copy } from "~/components";
import { usePanels } from "~/components/Layout";

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
              <Heading size="h4" className="flex items-center gap-2">
                <span>{routeData?.quote?.quoteId}</span>
              </Heading>
            </Link>
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
                {routeData?.opportunity?.salesOrderId === null ? (
                  <Button
                    isDisabled={
                      routeData?.opportunity?.salesOrderId !== null ||
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
