// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { useRuleViolations } from "@carbon/ee/rules";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  MENU_ITEM_SHORTCUTS,
  Status,
  useDisclosure
} from "@carbon/react";
import { formatDate, getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuCheckCheck,
  LuChevronDown,
  LuCircleCheck,
  LuCircleX,
  LuDollarSign,
  LuEye,
  LuFile,
  LuFileText,
  LuSend,
  LuTicketX,
  LuTrash,
  LuTruck
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import type { FetcherWithComponents } from "react-router";
import { Link, useFetcher, useParams } from "react-router";
import { useAuditLog } from "~/components/AuditLog";
import { usePanels } from "~/components/Layout/Panels";
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useSettings, useUser } from "~/hooks";
import { ShipmentStatus } from "~/modules/inventory/ui/Shipments";
import type { SalesInvoice, SalesInvoiceLine } from "~/modules/invoicing";
import { isInvoicePayable } from "~/modules/invoicing";
import { getPayInvoiceHref } from "~/modules/invoicing/ui/Payment/PaymentForm";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import SalesInvoicePostModal from "./SalesInvoicePostModal";
import SalesInvoiceStatus from "./SalesInvoiceStatus";
import SalesInvoiceVoidModal from "./SalesInvoiceVoidModal";

const SalesInvoiceHeader = () => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { invoiceId } = useParams();
  const { company } = useUser();
  const postingModal = useDisclosure();
  const voidModal = useDisclosure();
  const deleteModal = useDisclosure();
  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "salesInvoice",
    // @ts-expect-error TS2322 - TODO: fix type
    entityId: invoiceId,
    companyId: company.id,
    variant: "dropdown"
  });

  // Post submissions run through the violation hook's fetcher so a blocked
  // post opens the shared violation modal, with acknowledge-and-resubmit for
  // warns. The post modal closes itself on success.
  const postRules = useRuleViolations({
    action: path.to.salesInvoicePost(invoiceId ?? "")
  });
  const postFetcher = postRules.fetcher as FetcherWithComponents<{
    success?: boolean;
    message?: string;
    violations?: unknown[];
  }>;

  const { carbon } = useCarbon();
  const [linesNotAssociatedWithSO, setLinesNotAssociatedWithSO] = useState<
    {
      itemId: string | null;
      itemReadableId: string | null;
      description: string;
      quantity: number;
    }[]
  >([]);

  if (!invoiceId) throw new Error("invoiceId not found");

  const [items] = useItems();
  const routeData = useRouteData<{
    salesInvoice: SalesInvoice;
    salesInvoiceLines: SalesInvoiceLine[];
    defaultCc: string[];
    orgHasCredits: boolean;
    stripeInvoiceUrl: string | null;
  }>(path.to.salesInvoice(invoiceId));

  if (!routeData?.salesInvoice) throw new Error("salesInvoice not found");
  const { salesInvoice } = routeData;
  const { toggleExplorer, toggleProperties } = usePanels();
  const isPosted = salesInvoice.postingDate !== null;
  const isVoided = salesInvoice.status === "Voided";

  // Manual Mark as Paid is the settled signal for companies without
  // accounting; with accounting enabled invoices settle only via payments.
  // baseStatus is the stored salesInvoice.status (the view's status column is
  // derived from settlements, so a settlement-paid invoice stays untouched).
  const settings = useSettings();
  const accountingEnabled =
    (settings as { accountingEnabled?: boolean }).accountingEnabled ?? false;
  const baseStatus = (salesInvoice as { baseStatus?: string | null })
    .baseStatus;
  const statusFetcher = useFetcher<{}>();
  const canToggleManualPaid =
    !accountingEnabled && isPosted && permissions.can("update", "invoicing");
  const canMarkPaid = canToggleManualPaid && baseStatus === "Submitted";
  const canMarkUnpaid = canToggleManualPaid && baseStatus === "Paid";

  // Invoice automation outcome: a held draft waits for review; a posted
  // invoice was either sent (emailed or via Stripe) or failed to send (and
  // can be re-sent).
  const sendFetcher = useFetcher<{}>();
  const isPostedNotVoided = isPosted && !isVoided;
  const holdReason =
    salesInvoice.status === "Draft" ? salesInvoice.automationHoldReason : null;
  const sentTo = salesInvoice.sentTo ?? "";
  const sentDate = formatDate(salesInvoice.sentAt);
  const showEmailed = isPostedNotVoided && !!salesInvoice.sentAt;
  // A Stripe send stamps `sentTo: "Stripe"` — Stripe emailed it, not Carbon.
  const sentViaStripe = sentTo === "Stripe";
  const showNotSent =
    isPostedNotVoided && !!salesInvoice.sendError && !salesInvoice.sentAt;

  const [relatedDocs, setRelatedDocs] = useState<{
    salesOrders: { id: string; readableId: string }[];
    shipments: { id: string; readableId: string; status: string }[];
  }>({ salesOrders: [], shipments: [] });

  // Load related documents on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    async function getRelatedDocuments() {
      if (!carbon || !salesInvoice.opportunityId) return;

      const [salesOrdersResult, shipmentsResult] = await Promise.all([
        carbon
          .from("salesOrder")
          .select("id, salesOrderId")
          .eq("opportunityId", salesInvoice.opportunityId),
        carbon
          .from("shipment")
          .select("id, shipmentId, status")
          .eq("opportunityId", salesInvoice.opportunityId)
      ]);

      if (salesOrdersResult.error)
        throw new Error(salesOrdersResult.error.message);
      if (shipmentsResult.error) throw new Error(shipmentsResult.error.message);

      setRelatedDocs({
        salesOrders:
          salesOrdersResult.data?.map((po) => ({
            id: po.id,
            readableId: po.salesOrderId
          })) ?? [],
        shipments:
          shipmentsResult.data?.map((r) => ({
            id: r.id,
            readableId: r.shipmentId,
            status: r.status
          })) ?? []
      });
    }

    getRelatedDocuments();
  }, [carbon, salesInvoice.opportunityId, salesInvoice.status]);

  // The salesInvoices view does not carry the contract, so it is read off the
  // invoice row itself, with the contract's readable id embedded.
  const [contract, setContract] = useState<{
    id: string;
    readableId: string;
  } | null>(null);
  useEffect(() => {
    if (!carbon) return;
    let cancelled = false;
    carbon
      .from("salesInvoice")
      .select("customerContractId, customerContract(customerContractId)")
      .eq("id", invoiceId)
      .eq("companyId", company.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setContract(
          data?.customerContractId
            ? {
                id: data.customerContractId,
                readableId:
                  data.customerContract?.customerContractId ??
                  data.customerContractId
              }
            : null
        );
      });
    return () => {
      cancelled = true;
    };
  }, [carbon, invoiceId, company.id]);
  const contractReadableId = contract?.readableId;

  const showPostModal = async () => {
    // The lines posting will ship: items not on a sales order. A Service is
    // never shipped — post-sales-invoice skips it — so it is not listed.
    if (!carbon) throw new Error("carbon not found");
    const { data, error } = await carbon
      .from("salesInvoiceLine")
      .select("itemId, description, quantity")
      .eq("invoiceId", invoiceId)
      .in("invoiceLineType", [
        "Part",
        "Material",
        "Tool",
        "Consumable",
        "Fixture"
      ])
      .is("salesOrderLineId", null);

    if (error) throw new Error(error.message);
    if (!data) return;

    // so that we can ask the user if they want to receive those lines
    flushSync(() =>
      setLinesNotAssociatedWithSO(
        data?.map((d) => ({
          ...d,
          itemReadableId: getItemReadableId(items, d.itemId) ?? null,
          description: d.description ?? "",
          quantity: d.quantity
        })) ?? []
      )
    );
    postingModal.onOpen();
  };

  // Status is derived from invoiceSettlement rows, except base-status 'Paid',
  // which is the manual/legacy/Xero "settled" signal. Companies without
  // accounting can toggle it via Mark as Paid / Mark as Unpaid below; the
  // status route rejects manual 'Paid' when accounting is enabled.
  // "Receive Payment" launches the payment form pre-filled for this
  // invoice — NetSuite's Accept Payment pattern. Hidden once the
  // invoice is fully settled, voided, or pre-posting.
  const canReceivePayment =
    isInvoicePayable(salesInvoice.status, salesInvoice.balance) &&
    permissions.can("create", "invoicing");
  const receivePaymentHref = getPayInvoiceHref({
    side: "ar",
    partyId: salesInvoice.customerId,
    invoiceId,
    balance: salesInvoice.balance
  });
  const isDraft = routeData?.salesInvoice?.status === "Draft";
  const menuItems = (
    <>
      {auditLogTrigger}
      {canMarkPaid && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={statusFetcher.state !== "idle"}
            onClick={() =>
              statusFetcher.submit(
                { status: "Paid" },
                {
                  method: "post",
                  action: path.to.salesInvoiceStatus(invoiceId)
                }
              )
            }
          >
            <DropdownMenuIcon icon={<LuCircleCheck />} />
            <Trans>Mark as Paid</Trans>
          </DropdownMenuItem>
        </>
      )}
      {canMarkUnpaid && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={statusFetcher.state !== "idle"}
            onClick={() =>
              statusFetcher.submit(
                { status: "Submitted" },
                {
                  method: "post",
                  action: path.to.salesInvoiceStatus(invoiceId)
                }
              )
            }
          >
            <DropdownMenuIcon icon={<LuCircleX />} />
            <Trans>Mark as Unpaid</Trans>
          </DropdownMenuItem>
        </>
      )}
      {isPosted && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={isVoided || !permissions.can("update", "invoicing")}
            destructive
            onClick={voidModal.onOpen}
          >
            <DropdownMenuIcon icon={<LuTicketX />} />
            <Trans>Void</Trans>
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
        disabled={
          salesInvoice.status !== "Draft" ||
          !permissions.can("delete", "invoicing") ||
          !permissions.is("employee")
        }
        destructive
        onClick={deleteModal.onOpen}
      >
        <DropdownMenuIcon icon={<LuTrash />} />
        <Trans>Delete Sales Invoice</Trans>
      </DropdownMenuItem>
    </>
  );
  const statusBadges = (
    <>
      <SalesInvoiceStatus status={salesInvoice.status} />
      {holdReason && (
        <Status color="orange" tooltip={holdReason}>
          <Trans>Needs Review</Trans>
        </Status>
      )}
      {showEmailed &&
        (sentViaStripe ? (
          <Status color="green" tooltip={t`On ${sentDate}`}>
            <Trans>Sent via Stripe</Trans>
          </Status>
        ) : (
          <Status color="green" tooltip={t`To ${sentTo} on ${sentDate}`}>
            <Trans>Emailed</Trans>
          </Status>
        ))}
      {showNotSent && (
        <>
          <Status color="red" tooltip={salesInvoice.sendError}>
            <Trans>Not sent</Trans>
          </Status>
          <Button
            variant="secondary"
            leftIcon={<LuSend />}
            isLoading={sendFetcher.state !== "idle"}
            isDisabled={
              sendFetcher.state !== "idle" ||
              !permissions.can("update", "invoicing")
            }
            onClick={() =>
              sendFetcher.submit(
                {},
                {
                  method: "post",
                  action: path.to.salesInvoiceSend(invoiceId)
                }
              )
            }
          >
            <Trans>Send</Trans>
          </Button>
        </>
      )}
      {routeData?.stripeInvoiceUrl && isPosted && (
        <a
          href={routeData.stripeInvoiceUrl}
          target="_blank"
          rel="noreferrer"
          className="no-underline"
        >
          <Status color="purple">
            <Trans>Stripe</Trans>
          </Status>
        </a>
      )}
    </>
  );
  return (
    <>
      <RecordHeader
        title={routeData?.salesInvoice?.invoiceId}
        titleTo={path.to.salesInvoiceDetails(invoiceId)}
        copyValue={routeData?.salesInvoice?.invoiceId ?? ""}
        menu={menuItems}
        status={statusBadges}
        onToggleExplorer={toggleExplorer}
        onToggleProperties={toggleProperties}
        actions={
          <>
            {contract && (
              <RecordAction slot="overflow">
                <Button variant="secondary" leftIcon={<LuFileText />} asChild>
                  <Link to={path.to.contract(contract.id)}>
                    <Trans>Contract {contractReadableId}</Trans>
                  </Link>
                </Button>
              </RecordAction>
            )}

            {relatedDocs.salesOrders.length === 1 && (
              <RecordAction slot="overflow">
                <Button
                  variant="secondary"
                  leftIcon={<RiProgress8Line />}
                  asChild
                >
                  <Link
                    to={path.to.salesOrderDetails(
                      relatedDocs.salesOrders[0].id
                    )}
                  >
                    <Trans>Sales Order</Trans>
                  </Link>
                </Button>
              </RecordAction>
            )}

            {relatedDocs.salesOrders.length > 1 && (
              <RecordAction slot="overflow">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" leftIcon={<RiProgress8Line />}>
                      <Trans>Sales Orders</Trans>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {relatedDocs.salesOrders.map((po) => (
                      <DropdownMenuItem key={po.id} asChild>
                        <Link to={path.to.salesOrderDetails(po.id)}>
                          {po.readableId}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </RecordAction>
            )}

            {relatedDocs.shipments.length > 0 && (
              <RecordAction slot="overflow">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      leftIcon={<LuTruck />}
                      rightIcon={
                        relatedDocs.shipments.length > 1 ? (
                          <LuChevronDown />
                        ) : undefined
                      }
                    >
                      {relatedDocs.shipments.length === 1 ? (
                        <Trans>Shipment</Trans>
                      ) : (
                        <Trans>Shipments</Trans>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {relatedDocs.shipments.map((shipment) => (
                      <DropdownMenuItem key={shipment.id} asChild>
                        <Link to={path.to.shipment(shipment.id)}>
                          <DropdownMenuIcon icon={<LuTruck />} />
                          <HStack spacing={8}>
                            <span>{shipment.readableId}</span>
                            <ShipmentStatus
                              status={shipment.status as "Posted"}
                            />
                          </HStack>
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </RecordAction>
            )}
            <RecordAction slot="overflow">
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
                  <DropdownMenuItem asChild>
                    <a
                      target="_blank"
                      href={path.to.file.salesInvoice(invoiceId)}
                      rel="noreferrer"
                    >
                      <DropdownMenuIcon icon={<LuFile />} />
                      <Trans>PDF</Trans>
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </RecordAction>
            <RecordAction slot={isDraft ? "primary" : "secondary"}>
              <Button
                leftIcon={<LuCheckCheck />}
                variant={
                  routeData?.salesInvoice?.status === "Draft"
                    ? "primary"
                    : "secondary"
                }
                onClick={showPostModal}
                isLoading={postFetcher.state !== "idle"}
                isDisabled={
                  postFetcher.state !== "idle" ||
                  isPosted ||
                  routeData?.salesInvoiceLines?.length === 0 ||
                  !permissions.can("update", "invoicing")
                }
              >
                <Trans>Post</Trans>
              </Button>
            </RecordAction>
            {canReceivePayment && (
              <RecordAction slot={isDraft ? "secondary" : "primary"}>
                <Button variant="primary" leftIcon={<LuDollarSign />} asChild>
                  <Link to={receivePaymentHref}>
                    <Trans>Payment</Trans>
                  </Link>
                </Button>
              </RecordAction>
            )}
          </>
        }
      />

      {postingModal.isOpen && (
        <SalesInvoicePostModal
          invoiceId={invoiceId}
          customerId={salesInvoice.invoiceCustomerId}
          customerContactId={salesInvoice.invoiceCustomerContactId}
          dateDue={salesInvoice.dateDue}
          isOpen={postingModal.isOpen}
          onClose={postingModal.onClose}
          linesToShip={linesNotAssociatedWithSO}
          fetcher={postFetcher}
          defaultCc={routeData?.defaultCc ?? []}
        />
      )}
      <postRules.ViolationModal />
      {voidModal.isOpen && (
        <SalesInvoiceVoidModal onClose={voidModal.onClose} />
      )}
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteSalesInvoice(invoiceId)}
          isOpen={deleteModal.isOpen}
          name={salesInvoice.invoiceId ?? "sales invoice"}
          text={t`Are you sure you want to delete ${salesInvoice.invoiceId}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
          }}
          onSubmit={() => {
            deleteModal.onClose();
          }}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

export default SalesInvoiceHeader;
