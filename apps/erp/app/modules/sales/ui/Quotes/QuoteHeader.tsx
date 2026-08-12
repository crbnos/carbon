import {
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
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
  toast,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
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
  LuShare2,
  LuTrash,
  LuTrophy
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { useAuditLog } from "~/components/AuditLog";
import { usePanels } from "~/components/Layout";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { isQuoteLocked } from "../../sales.models";
import type {
  Opportunity,
  Quotation,
  QuotationLine,
  QuotationPrice,
  QuotationShipment
} from "../../types";
import QuoteFinalizeModal from "./QuoteFinalizeModal";
import QuoteStatus from "./QuoteStatus";
import QuoteToOrderDrawer from "./QuoteToOrderDrawer";

const QuoteHeader = () => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");

  const { company } = useUser();
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
  const deleteQuoteModal = useDisclosure();
  const [asRevision, setAsRevision] = useState(false);

  const finalizeFetcher = useFetcher<{}>();
  const statusFetcher = useFetcher<{}>();

  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "salesQuote",
    entityId: quoteId,
    companyId: company.id,
    variant: "dropdown"
  });

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-background border-b h-[50px] overflow-x-auto scrollbar-hide">
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label={t`Toggle Explorer`}
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
            <Copy text={routeData?.quote?.quoteId ?? ""} />
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
                {auditLogTrigger}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setAsRevision(false);
                    createRevisionModal.onOpen();
                  }}
                >
                  <DropdownMenuIcon icon={<LuCopy />} />
                  <Trans>Copy Quote</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setAsRevision(true);
                    createRevisionModal.onOpen();
                  }}
                >
                  <DropdownMenuIcon icon={<LuGitBranchPlus />} />
                  <Trans>Create Quote Revision</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={
                    routeData?.quote?.status === "Draft" ||
                    (routeData?.opportunity?.salesOrders.length ?? 0) > 0 ||
                    statusFetcher.state !== "idle" ||
                    !permissions.can("update", "sales")
                  }
                  onClick={() => {
                    statusFetcher.submit(
                      { status: "Draft" },
                      {
                        method: "post",
                        action: path.to.quoteStatus(quoteId)
                      }
                    );
                  }}
                >
                  <DropdownMenuIcon icon={<LuLoaderCircle />} />
                  <Trans>Reopen</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={
                    !permissions.can("delete", "sales") ||
                    !permissions.is("employee") ||
                    isQuoteLocked(routeData?.quote?.status)
                  }
                  destructive
                  onClick={deleteQuoteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Quote</Trans>
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
                leftIcon={<LuShare2 />}
                variant="secondary"
              >
                <Trans>Share</Trans>
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    leftIcon={<LuEye />}
                    variant="secondary"
                    rightIcon={<LuChevronDown />}
                  >
                    <Trans>Preview</Trans>
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
                        <Trans>Digital Quote</Trans>
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
                      <Trans>PDF</Trans>
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
              <Trans>Finalize</Trans>
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
              <Trans>Won</Trans>
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
                <Trans>Lost</Trans>
              </Button>
            </statusFetcher.Form>

            {routeData?.quote?.status === "Draft" && (
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
                  <Trans>Cancel</Trans>
                </Button>
              </statusFetcher.Form>
            )}

            <IconButton
              aria-label={t`Toggle Properties`}
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
          shipment={routeData?.shipment ?? null}
          onClose={finalizeModal.onClose}
          fetcher={finalizeFetcher}
          // @ts-expect-error TS2339 - TODO: fix type
          defaultCc={routeData?.defaultCc ?? []}
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
      {deleteQuoteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteQuote(quoteId)}
          isOpen={deleteQuoteModal.isOpen}
          name={routeData?.quote?.quoteId!}
          text={t`Are you sure you want to delete ${routeData?.quote
            ?.quoteId!}? This cannot be undone.`}
          onCancel={() => {
            deleteQuoteModal.onClose();
          }}
          onSubmit={() => {
            deleteQuoteModal.onClose();
          }}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

export default QuoteHeader;

function CreateRevisionModal({
  quote,
  asRevision,
  onClose
}: {
  quote?: Quotation;
  asRevision: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [newQuoteId, setNewQuoteId] = useState<string | null>(null);
  const fetcher = useFetcher<
    | { success: false; message: string }
    | { success: true; data: { newQuoteId: string } }
  >();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (fetcher.data?.success === false) {
      toast.error(fetcher.data?.message);
    }

    if (fetcher.data?.success === true) {
      toast.success(
        asRevision
          ? t`Successfully created a new revision`
          : t`Successfully copied quote`
      );
      setNewQuoteId(fetcher.data?.data.newQuoteId ?? null);
    }
  }, [fetcher.data?.success, t]);

  if (!quote) return null;
  return (
    <Modal open onOpenChange={onClose}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            {asRevision ? (
              <Trans>Create Quote Revision</Trans>
            ) : (
              <Trans>Copy Quote</Trans>
            )}
          </ModalTitle>
          <ModalDescription>
            {asRevision ? (
              <Trans>The quote will be copied with a revision suffix</Trans>
            ) : (
              <Trans>Create a quote with a new quote ID</Trans>
            )}
          </ModalDescription>
        </ModalHeader>
        {newQuoteId ? (
          <>
            <ModalBody>
              <div className="flex flex-col items-center justify-center py-8">
                <div>
                  <LuCheck className="w-16 h-16 text-green-500" />
                </div>
                <h2 className="animate-fade-in">
                  <Trans>The quote has been created</Trans>
                </h2>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button asChild>
                <Link to={path.to.quoteDetails(newQuoteId)}>
                  <Trans>Open</Trans>
                </Link>
              </Button>
            </ModalFooter>
          </>
        ) : (
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
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
                {asRevision ? (
                  <Trans>Create Revision</Trans>
                ) : (
                  <Trans>Copy Quote</Trans>
                )}
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
  onClose
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
          <ModalTitle>
            <Trans>Share Quote</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>Copy this link to share the quote with a customer</Trans>
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
            <Trans>Close</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
