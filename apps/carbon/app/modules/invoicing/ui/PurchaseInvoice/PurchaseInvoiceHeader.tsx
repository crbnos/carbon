import { useCarbon } from "@carbon/auth";
import {
  Card,
  CardAttribute,
  CardAttributeLabel,
  CardAttributeValue,
  CardAttributes,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Menubar,
  MenubarItem,
  VStack,
  useDisclosure,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useParams } from "@remix-run/react";
import { useState } from "react";
import { Assignee, useOptimisticAssignment } from "~/components";
import { useCurrencyFormatter, usePermissions, useRouteData } from "~/hooks";
import type { PurchaseInvoice } from "~/modules/invoicing";
import {
  PurchaseInvoicingStatus,
  usePurchaseInvoiceTotals,
} from "~/modules/invoicing";
import { useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import PurchaseInvoicePostModal from "./PurchaseInvoicePostModal";

const PurchaseInvoiceHeader = () => {
  const permissions = usePermissions();
  const { invoiceId } = useParams();
  const postingModal = useDisclosure();

  const { carbon } = useCarbon();
  const [linesNotAssociatedWithPO, setLinesNotAssociatedWithPO] = useState<
    { itemId: string | null; itemReadableId: string | null; quantity: number }[]
  >([]);

  if (!invoiceId) throw new Error("invoiceId not found");

  const routeData = useRouteData<{ purchaseInvoice: PurchaseInvoice }>(
    path.to.purchaseInvoice(invoiceId)
  );

  if (!routeData?.purchaseInvoice) throw new Error("purchaseInvoice not found");
  const { purchaseInvoice } = routeData;

  const isPosted = purchaseInvoice.postingDate !== null;

  const [purchaseInvoiceTotals] = usePurchaseInvoiceTotals();

  const formatter = useCurrencyFormatter();
  const showPostModal = async () => {
    // check if there are any lines that are not associated with a PO
    if (!carbon) throw new Error("carbon not found");
    const { data, error } = await carbon
      .from("purchaseInvoiceLine")
      .select("itemId, itemReadableId, quantity, conversionFactor")
      .eq("invoiceId", invoiceId)
      .in("invoiceLineType", ["Part", "Material", "Tool", "Consumable"])
      .is("purchaseOrderLineId", null);

    if (error) throw new Error(error.message);
    if (!data) return;

    // so that we can ask the user if they want to receive those lines
    setLinesNotAssociatedWithPO(
      data?.map((d) => ({
        ...d,
        quantity: d.quantity * (d.conversionFactor ?? 1),
      })) ?? []
    );
    postingModal.onOpen();
  };

  const optimisticAssignment = useOptimisticAssignment({
    id: invoiceId,
    table: "purchaseInvoice",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.purchaseInvoice?.assignee;

  const [suppliers] = useSuppliers();
  const supplier = suppliers.find(
    (s) => s.id === routeData.purchaseInvoice?.supplierId
  );

  return (
    <>
      <VStack>
        {permissions.is("employee") && (
          <Menubar>
            <MenubarItem
              isDisabled={!permissions.can("update", "invoicing") || isPosted}
              onClick={showPostModal}
            >
              Post
            </MenubarItem>
          </Menubar>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{purchaseInvoice.invoiceId}</CardTitle>
            <CardDescription>{supplier ? supplier.name : "-"}</CardDescription>
          </CardHeader>

          <CardContent>
            <CardAttributes>
              <CardAttribute>
                <CardAttributeLabel>Status</CardAttributeLabel>
                <PurchaseInvoicingStatus status={purchaseInvoice.status} />
              </CardAttribute>

              <CardAttribute>
                <CardAttributeLabel>Assignee</CardAttributeLabel>
                <CardAttributeValue>
                  <Assignee
                    id={invoiceId}
                    table="purchaseInvoice"
                    value={assignee ?? undefined}
                    isReadOnly={!permissions.can("update", "invoicing")}
                  />
                </CardAttributeValue>
              </CardAttribute>

              <CardAttribute>
                <CardAttributeLabel>Date Due</CardAttributeLabel>
                <CardAttributeValue>
                  {formatDate(purchaseInvoice.dateDue)}
                </CardAttributeValue>
              </CardAttribute>

              <CardAttribute>
                <CardAttributeLabel>Date Issued</CardAttributeLabel>
                <CardAttributeValue>
                  {formatDate(purchaseInvoice.dateIssued)}
                </CardAttributeValue>
              </CardAttribute>

              <CardAttribute>
                <CardAttributeLabel>Date Paid</CardAttributeLabel>
                <CardAttributeValue>
                  {formatDate(purchaseInvoice.datePaid)}
                </CardAttributeValue>
              </CardAttribute>

              <CardAttribute>
                <CardAttributeLabel>Total</CardAttributeLabel>
                <CardAttributeValue>
                  {formatter.format(purchaseInvoiceTotals?.total ?? 0)}
                </CardAttributeValue>
              </CardAttribute>
            </CardAttributes>
          </CardContent>
        </Card>
      </VStack>
      <PurchaseInvoicePostModal
        invoiceId={invoiceId}
        isOpen={postingModal.isOpen}
        onClose={postingModal.onClose}
        linesToReceive={linesNotAssociatedWithPO}
      />
    </>
  );
};

export default PurchaseInvoiceHeader;
