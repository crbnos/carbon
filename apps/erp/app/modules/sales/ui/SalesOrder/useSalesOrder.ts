import { useNavigate } from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
import { path } from "~/utils/path";
import { SalesOrder } from "../../types";
import { useCarbon } from "@carbon/auth";
import { toast } from "@carbon/react";
import { Shipment } from "~/modules/inventory";

export const useSalesOrder = () => {
  const navigate = useNavigate();

  const edit = useCallback(
    (salesOrder: SalesOrder) => navigate(path.to.salesOrder(salesOrder.id!)),
    [navigate]
  );

  const invoice = useCallback(
    (salesOrder: SalesOrder) =>
      navigate(
        `${path.to.newSalesInvoice}?sourceDocument=Sales Order&sourceDocumentId=${salesOrder.id}`
      ),
    [navigate]
  );

  const ship = useCallback(
    (salesOrder: SalesOrder) =>
      navigate(
        `${path.to.newShipment}?sourceDocument=Sales Order&sourceDocumentId=${salesOrder.id}`
      ),
    [navigate]
  );

  return {
    edit,
    invoice,
    ship,
  };
};

export const useSalesOrderRelatedDocuments = (opportunityId: string) => {
  const [shipments, setShipments] = useState<
    Pick<Shipment, "id" | "shipmentId" | "status">[]
  >([]);
  // const [invoices, setInvoices] = useState<
  //   Pick<SalesInvoice, "id" | "invoiceId" | "status">[]
  // >([]);

  const { carbon } = useCarbon();

  const getRelatedDocuments = useCallback(
    async (opportunityId: string) => {
      if (!carbon || !opportunityId) return;
      const [shipments] = await Promise.all([
        carbon
          .from("shipment")
          .select("id, shipmentId, status")
          .eq("opportunityId", opportunityId),
        // carbon
        //   .from("salesInvoice")
        //   .select("id, invoiceId, status")
        //   .eq("opportunityId", opportunityId),
      ]);

      if (shipments.error) {
        toast.error("Failed to load shipments");
      } else {
        setShipments(shipments.data);
      }

      // if (invoices.error) {
      //   toast.error("Failed to load invoices");
      // } else {
      //   setInvoices(invoices.data);
      // }
    },
    [carbon]
  );

  useEffect(() => {
    getRelatedDocuments(opportunityId);
  }, [getRelatedDocuments, opportunityId]);

  return { shipments, invoices: [] };
};
