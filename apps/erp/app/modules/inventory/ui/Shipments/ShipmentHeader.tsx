// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MENU_ITEM_SHORTCUTS,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import { LuCheckCheck, LuCreditCard, LuTicketX, LuTrash } from "react-icons/lu";
import { Await, useNavigate, useNavigation, useParams } from "react-router";
import { DateTime, EmployeeAvatar, PrintButton } from "~/components";
import { DocumentPageHeader } from "~/components/DocumentPage";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemTracking, Shipment, ShipmentLine } from "~/modules/inventory";
import type { SalesInvoice } from "~/modules/invoicing/types";
import { path } from "~/utils/path";
import ShipmentPostModal from "./ShipmentPostModal";
import ShipmentStatus from "./ShipmentStatus";
import ShipmentVoidModal from "./ShipmentVoidModal";

const ShipmentHeader = () => {
  const { t } = useLingui();
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const routeData = useRouteData<{
    shipment: Shipment;
    shipmentLines: ShipmentLine[];
    shipmentLineTracking: ItemTracking[];
    fixedAssetLines: { id: string; shipped: boolean }[];
    rentalLines: { id: string; shipped: boolean }[];
    relatedItems?: Promise<{ invoices: SalesInvoice[] }>;
  }>(path.to.shipment(shipmentId));

  const permissions = usePermissions();
  const postModal = useDisclosure();
  const voidModal = useDisclosure();
  const deleteDisclosure = useDisclosure();

  const shipment = routeData?.shipment;
  if (!shipment) throw new Error("Could not find shipment in routeData");

  const status = shipment.status;
  const isPosted = status === "Posted";
  const isVoided = status === "Voided";

  const shipmentLines = routeData?.shipmentLines ?? [];
  const hasShippableFaLines = (routeData?.fixedAssetLines ?? []).some(
    (line) => line.shipped
  );
  const hasShippableRentalLines = (routeData?.rentalLines ?? []).some(
    (line) => line.shipped
  );
  const canPost =
    shipmentLines.some((line) => (line.shippedQuantity ?? 0) !== 0) ||
    hasShippableFaLines ||
    hasShippableRentalLines;

  const hasTrackingLabels = (routeData?.shipmentLineTracking ?? []).length > 0;

  return (
    <>
      <DocumentPageHeader
        title={shipment.shipmentId}
        status={<ShipmentStatus status={status} invoiced={shipment.invoiced} />}
        meta={[
          <Trans key="created">
            Created <DateTime value={shipment.createdAt} variant="relative" />{" "}
            by <EmployeeAvatar employeeId={shipment.createdBy} />
          </Trans>,
          shipment.postingDate ? (
            shipment.postedBy ? (
              <Trans key="posted">
                Posted <DateTime value={shipment.postingDate} variant="date" />{" "}
                by <EmployeeAvatar employeeId={shipment.postedBy} />
              </Trans>
            ) : (
              <Trans key="posted">
                Posted <DateTime value={shipment.postingDate} variant="date" />
              </Trans>
            )
          ) : null
        ]}
        menuItems={
          <>
            {isPosted && (
              <>
                <DropdownMenuItem
                  disabled={!permissions.is("employee")}
                  destructive
                  onClick={voidModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTicketX />} />
                  <Trans>Void</Trans>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              disabled={
                !permissions.can("delete", "inventory") ||
                !permissions.is("employee")
              }
              destructive
              onClick={deleteDisclosure.onOpen}
            >
              <DropdownMenuIcon icon={<LuTrash />} />
              <Trans>Delete Shipment</Trans>
            </DropdownMenuItem>
          </>
        }
        actions={
          <>
            {hasTrackingLabels && (
              <PrintButton
                sourceDocument="Shipment"
                sourceDocumentId={shipmentId}
                locationId={shipment.locationId ?? undefined}
                context="shipping"
                fileRoutes={{
                  pdf: path.to.file.shipmentLabelsPdf,
                  zpl: path.to.file.shipmentLabelsZpl
                }}
              />
            )}
            {shipment.sourceDocument === "Sales Order" &&
              permissions.can("view", "invoicing") && (
                <InvoiceButton
                  shipment={shipment}
                  relatedItems={routeData?.relatedItems}
                />
              )}
            {!isPosted && !isVoided && (
              <Button
                variant="primary"
                onClick={postModal.onOpen}
                isDisabled={!canPost || !permissions.is("employee")}
                leftIcon={<LuCheckCheck />}
              >
                <Trans>Post</Trans>
              </Button>
            )}
          </>
        }
      />

      {postModal.isOpen && <ShipmentPostModal onClose={postModal.onClose} />}
      {voidModal.isOpen && <ShipmentVoidModal onClose={voidModal.onClose} />}
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteShipment(shipmentId)}
          isOpen={deleteDisclosure.isOpen}
          name={shipment.shipmentId ?? "shipment"}
          text={t`Are you sure you want to delete ${shipment.shipmentId}? This cannot be undone.`}
          onCancel={deleteDisclosure.onClose}
          onSubmit={deleteDisclosure.onClose}
        />
      )}
    </>
  );
};

/**
 * Raises the sales invoice for a posted sales-order shipment. Once this
 * shipment has an invoice, the invoice is listed under Documents instead.
 */
function InvoiceButton({
  shipment,
  relatedItems
}: {
  shipment: Shipment;
  relatedItems?: Promise<{ invoices: SalesInvoice[] }>;
}) {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const permissions = usePermissions();
  const isInvoicing =
    navigation.state !== "idle" &&
    navigation.location?.pathname === path.to.newSalesInvoice;

  const isPosted = shipment.status === "Posted";
  const isVoided = shipment.status === "Voided";

  const createInvoice = () =>
    navigate(
      `${path.to.newSalesInvoice}?sourceDocument=Shipment&sourceDocumentId=${shipment.id}`
    );

  return (
    <Suspense
      fallback={
        <Button variant="secondary" isDisabled leftIcon={<LuCreditCard />}>
          <Trans>Invoice</Trans>
        </Button>
      }
    >
      <Await
        resolve={relatedItems}
        errorElement={
          // Without the invoices it is unknown whether one exists already.
          <Button variant="secondary" isDisabled leftIcon={<LuCreditCard />}>
            <Trans>Invoice</Trans>
          </Button>
        }
      >
        {(resolved) => {
          const invoices = resolved?.invoices ?? [];
          if (
            invoices.some(
              (invoice) =>
                invoice.shipmentId === shipment.id &&
                invoice.status !== "Voided"
            )
          ) {
            return null;
          }
          return (
            <Button
              leftIcon={<LuCreditCard />}
              variant={isPosted && !isVoided ? "primary" : "secondary"}
              isDisabled={
                !isPosted ||
                isVoided ||
                isInvoicing ||
                !permissions.can("create", "invoicing")
              }
              isLoading={isInvoicing}
              onClick={createInvoice}
            >
              <Trans>Invoice</Trans>
            </Button>
          );
        }}
      </Await>
    </Suspense>
  );
}

export default ShipmentHeader;
