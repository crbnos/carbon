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
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuChevronDown,
  LuCircleX,
  LuEllipsisVertical,
  LuEye,
  LuGitCompare,
  LuLoaderCircle,
  LuPanelLeft,
  LuPanelRight,
  LuSend,
  LuShare2,
  LuTrash,
  LuTriangleAlert
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { usePanels } from "~/components/Layout";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import { useIntegrations } from "~/hooks/useIntegrations";
import { path } from "~/utils/path";
import { isRfqLocked } from "../../purchasing.models";
import type { PurchasingRFQ, PurchasingRFQLine } from "../../types";
import { SupplierQuoteCompareDrawer } from "../SupplierQuote";
import FinalizeRFQModal from "./FinalizeRFQModal";
import PurchasingRFQStatus from "./PurchasingRFQStatus";

const PurchasingRFQHeader = () => {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("rfqId not found");

  const { t } = useLingui();
  const finalizeModal = useDisclosure();
  const requiresSuppliersAlert = useDisclosure();
  const cancelReasonModal = useDisclosure();
  const deleteRFQModal = useDisclosure();
  const compareQuotesModal = useDisclosure();
  const { toggleExplorer, toggleProperties } = usePanels();

  const permissions = usePermissions();
  const integrations = useIntegrations();
  const canEmail = integrations.has("email");
  const finalizeFetcher = useFetcher<{ error: string | null }>();

  const routeData = useRouteData<{
    rfqSummary: PurchasingRFQ;
    lines: PurchasingRFQLine[];
    suppliers: {
      id: string;
      supplierId: string;
      supplier: { id: string; name: string };
      quoteExternalLinkId?: string;
    }[];
    linkedQuotes: unknown[];
  }>(path.to.purchasingRfq(rfqId));

  const status = routeData?.rfqSummary?.status ?? "Draft";
  const isLocked = isRfqLocked(status);

  const statusFetcher = useFetcher<{}>();

  const hasSuppliers = (routeData?.suppliers?.length ?? 0) > 0;
  const activeLinkedQuotes = (routeData?.linkedQuotes ?? []).filter(
    (q: any) => q.status === "Active"
  );
  const canCompareQuotes = activeLinkedQuotes.length > 1;

  return (
    <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b h-[var(--header-height)] overflow-x-auto scrollbar-hide ">
      <HStack className="w-full justify-between">
        <HStack>
          <IconButton
            aria-label={t`Toggle Explorer`}
            icon={<LuPanelLeft />}
            onClick={toggleExplorer}
            variant="ghost"
          />
          <Link to={path.to.purchasingRfqDetails(rfqId)}>
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
                  status !== "Closed" ||
                  statusFetcher.state !== "idle" ||
                  !permissions.can("update", "purchasing")
                }
                onClick={() => {
                  statusFetcher.submit(
                    { status: "Draft" },
                    {
                      method: "post",
                      action: path.to.purchasingRfqStatus(rfqId)
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
                  !permissions.can("delete", "purchasing") ||
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
          <PurchasingRFQStatus status={routeData?.rfqSummary?.status} />
        </HStack>
        <HStack>
          {/* Preview Button - for Draft status */}
          {status === "Draft" && (
            <Button variant="secondary" leftIcon={<LuEye />} asChild>
              <Link to={path.to.purchasingRfqPreview(rfqId)} target="_blank">
                <Trans>Preview</Trans>
              </Link>
            </Button>
          )}

          {/* Share Dropdown - for Requested status with external links */}
          {status === "Requested" && hasSuppliers && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  leftIcon={<LuShare2 />}
                  rightIcon={<LuChevronDown />}
                >
                  <Trans>Share</Trans>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {routeData?.suppliers?.map((supplier) => (
                  <DropdownMenuItem
                    key={supplier.id}
                    disabled={!supplier.quoteExternalLinkId}
                    onClick={() => {
                      if (supplier.quoteExternalLinkId) {
                        window.open(
                          path.to.externalSupplierQuote(
                            supplier.quoteExternalLinkId
                          ),
                          "_blank"
                        );
                      }
                    }}
                  >
                    <DropdownMenuIcon icon={<LuShare2 />} />
                    {supplier.supplier.name}
                    {supplier.quoteExternalLinkId &&
                      typeof window !== "undefined" && (
                        <Copy
                          className="ml-2"
                          text={`${
                            window.location.origin
                          }${path.to.externalSupplierQuote(
                            supplier.quoteExternalLinkId
                          )}`}
                        />
                      )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {hasSuppliers ? (
            canEmail ? (
              // With Resend: Open modal for contact selection
              <Button
                isDisabled={
                  status !== "Draft" ||
                  routeData?.lines?.length === 0 ||
                  !permissions.can("create", "purchasing")
                }
                leftIcon={<LuSend />}
                variant={status === "Draft" ? "primary" : "secondary"}
                onClick={finalizeModal.onOpen}
              >
                <Trans>Finalize</Trans>
              </Button>
            ) : (
              // Without Resend: Submit directly
              <finalizeFetcher.Form
                method="post"
                action={path.to.purchasingRfqFinalize(rfqId)}
              >
                {routeData?.suppliers?.map((supplier, index) => (
                  <span key={supplier.id}>
                    <input
                      type="hidden"
                      name={`suppliers[${index}].supplierId`}
                      value={supplier.supplierId}
                    />
                    <input
                      type="hidden"
                      name={`suppliers[${index}].rfqSupplierId`}
                      value={supplier.id}
                    />
                  </span>
                ))}
                <Button
                  type="submit"
                  isDisabled={
                    status !== "Draft" ||
                    routeData?.lines?.length === 0 ||
                    !permissions.can("create", "purchasing") ||
                    finalizeFetcher.state !== "idle"
                  }
                  isLoading={finalizeFetcher.state !== "idle"}
                  leftIcon={<LuSend />}
                  variant={status === "Draft" ? "primary" : "secondary"}
                >
                  <Trans>Finalize</Trans>
                </Button>
              </finalizeFetcher.Form>
            )
          ) : (
            <Button
              isDisabled={
                status !== "Draft" ||
                routeData?.lines?.length === 0 ||
                !permissions.can("create", "purchasing")
              }
              leftIcon={<LuSend />}
              variant={status === "Draft" ? "primary" : "secondary"}
              onClick={requiresSuppliersAlert.onOpen}
            >
              <Trans>Finalize</Trans>
            </Button>
          )}

          {/* Cancel Button - sets status to Closed */}
          <Button
            onClick={cancelReasonModal.onOpen}
            isDisabled={
              (status !== "Draft" && status !== "Requested") ||
              !permissions.can("update", "purchasing")
            }
            leftIcon={<LuCircleX />}
            variant="secondary"
          >
            <Trans>Cancel</Trans>
          </Button>

          {canCompareQuotes && (
            <Button
              onClick={compareQuotesModal.onOpen}
              leftIcon={<LuGitCompare />}
              variant="secondary"
            >
              <Trans>Compare Quotes</Trans>
            </Button>
          )}

          <IconButton
            aria-label={t`Toggle Properties`}
            icon={<LuPanelRight />}
            onClick={toggleProperties}
            variant="ghost"
          />
        </HStack>
      </HStack>
      {finalizeModal.isOpen && (
        <FinalizeRFQModal
          lines={routeData?.lines ?? []}
          suppliers={routeData?.suppliers ?? []}
          rfqId={rfqId}
          onClose={finalizeModal.onClose}
        />
      )}
      {requiresSuppliersAlert.isOpen && (
        <RequiresSuppliersAlert onClose={requiresSuppliersAlert.onClose} />
      )}
      {cancelReasonModal.isOpen && (
        <ConfirmDelete
          action={path.to.cancelPurchasingRfq(rfqId)}
          isOpen={cancelReasonModal.isOpen}
          name={routeData?.rfqSummary?.rfqId!}
          text={t`Are you sure you want to cancel ${routeData?.rfqSummary
            ?.rfqId!}? This will also cancel all related supplier quotes.`}
          deleteText="Cancel"
          onCancel={() => {
            cancelReasonModal.onClose();
          }}
          onSubmit={() => {
            cancelReasonModal.onClose();
          }}
        />
      )}
      {deleteRFQModal.isOpen && (
        <ConfirmDelete
          action={path.to.deletePurchasingRfq(rfqId)}
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
      {compareQuotesModal.isOpen && (
        <SupplierQuoteCompareDrawer
          isOpen={compareQuotesModal.isOpen}
          onClose={compareQuotesModal.onClose}
          purchasingRfqId={rfqId}
        />
      )}
    </div>
  );
};

export default PurchasingRFQHeader;

function RequiresSuppliersAlert({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Cannot send RFQ</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <Alert variant="destructive">
            <LuTriangleAlert className="h-4 w-4" />
            <AlertTitle>
              <Trans>RFQ has no suppliers</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                In order to send this RFQ to suppliers, you must first add
                suppliers to the RFQ.
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
