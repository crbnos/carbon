import {
  Button,
  HStack,
  Heading,
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
  useDisclosure,
} from "@carbon/react";

import { Link, useFetcher, useParams } from "@remix-run/react";
import {
  LuCheckCheck,
  LuFile,
  LuRefreshCw,
  LuShare,
  LuStopCircle,
  LuTrophy,
  LuXCircle,
} from "react-icons/lu";
import { Assignee, Copy, useOptimisticAssignment } from "~/components";

import { usePermissions, useRouteData } from "~/hooks";
import type { Quotation, QuotationLine, QuotationPrice } from "~/modules/sales";
import { path } from "~/utils/path";
import QuoteFinalizeModal from "./QuoteFinalizeModal";
import QuoteStatus from "./QuoteStatus";
import QuoteToOrderModal from "./QuoteToOrderModal";

const QuoteHeader = () => {
  const permissions = usePermissions();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");

  const routeData = useRouteData<{
    quote: Quotation;
    lines: QuotationLine[];
    prices: QuotationPrice[];
  }>(path.to.quote(quoteId));

  const eligibleLines = routeData?.lines.filter(
    (line) => line.status !== "No Quote"
  );

  const finalizeModal = useDisclosure();
  const convertToOrderModal = useDisclosure();
  const shareModal = useDisclosure();

  const optimisticAssignment = useOptimisticAssignment({
    id: quoteId,
    table: "quote",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.quote?.assignee;

  const finalizeFetcher = useFetcher<{}>();
  const statusFetcher = useFetcher<{}>();

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border">
        <HStack className="w-full justify-between">
          <HStack>
            <Link to={path.to.quoteDetails(quoteId)}>
              <Heading size="h3" className="flex items-center gap-2">
                {/* <ModuleIcon icon={<RiProgress4Line />} /> */}
                <span>{routeData?.quote?.quoteId}</span>
              </Heading>
            </Link>
            <Copy text={routeData?.quote?.quoteId ?? ""} />
            <QuoteStatus status={routeData?.quote?.status} />
          </HStack>
          <HStack>
            <Assignee
              id={quoteId}
              table="quote"
              value={assignee ?? ""}
              className="h-8"
              isReadOnly={!permissions.can("update", "sales")}
            />
            {routeData?.quote.externalLinkId && (
              <Button
                onClick={shareModal.onOpen}
                leftIcon={<LuShare />}
                variant="secondary"
              >
                Share
              </Button>
            )}

            {routeData?.quote?.status === "Draft" && (
              <>
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
                    leftIcon={<LuStopCircle />}
                    type="submit"
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                </statusFetcher.Form>
                <Button
                  onClick={finalizeModal.onOpen}
                  isLoading={finalizeFetcher.state !== "idle"}
                  isDisabled={
                    finalizeFetcher.state !== "idle" ||
                    !permissions.can("update", "sales") ||
                    !eligibleLines?.length
                  }
                  leftIcon={<LuCheckCheck />}
                >
                  Finalize
                </Button>
              </>
            )}
            {routeData?.quote?.status === "Sent" && (
              <>
                <statusFetcher.Form
                  method="post"
                  action={path.to.quoteStatus(quoteId)}
                >
                  <input type="hidden" name="status" value="Draft" />
                  <Button
                    isDisabled={
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
                </statusFetcher.Form>
                <statusFetcher.Form
                  method="post"
                  action={path.to.quoteStatus(quoteId)}
                >
                  <input type="hidden" name="status" value="Lost" />
                  <Button
                    isDisabled={
                      statusFetcher.state !== "idle" ||
                      !permissions.can("update", "sales")
                    }
                    isLoading={
                      statusFetcher.state !== "idle" &&
                      statusFetcher.formData?.get("status") === "Lost"
                    }
                    leftIcon={<LuXCircle />}
                    type="submit"
                    variant="destructive"
                  >
                    Lost
                  </Button>
                </statusFetcher.Form>

                <Button
                  leftIcon={<LuTrophy />}
                  variant="primary"
                  onClick={convertToOrderModal.onOpen}
                >
                  Won
                </Button>
              </>
            )}
            {["Cancelled", "Expired", "Lost"].includes(
              routeData?.quote?.status ?? ""
            ) && (
              <>
                <statusFetcher.Form
                  method="post"
                  action={path.to.quoteStatus(quoteId)}
                >
                  <input type="hidden" name="status" value="Draft" />
                  <Button
                    isDisabled={
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
                </statusFetcher.Form>
              </>
            )}
            {["Ordered", "Partial"].includes(
              routeData?.quote?.status ?? ""
            ) && (
              <statusFetcher.Form
                method="post"
                action={path.to.quoteStatus(quoteId)}
              >
                <input type="hidden" name="status" value="Draft" />
                <Button
                  isDisabled={
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
              </statusFetcher.Form>
            )}
          </HStack>
        </HStack>
      </div>
      {finalizeModal.isOpen && (
        <QuoteFinalizeModal
          quote={routeData?.quote}
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
      <QuoteToOrderModal
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
          {id && (
            <Button leftIcon={<LuFile />} asChild>
              <a target="_blank" href={path.to.file.quote(id)} rel="noreferrer">
                Preview PDF
              </a>
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
