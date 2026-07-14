import { useCarbon } from "@carbon/auth";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { flushSync } from "react-dom";
import type { z } from "zod";
import type {
  ExtractedDocumentData,
  PurchaseInvoiceExtraction,
  PurchaseInvoiceLineItem
} from "~/modules/documents";
import {
  findMatchingContactId,
  findMatchingLocationId,
  getExtractionMatchCandidates
} from "~/modules/documents";
import type { purchaseInvoiceValidator } from "~/modules/invoicing";

type PurchaseInvoiceFormValues = z.infer<typeof purchaseInvoiceValidator>;

type InvoiceSupplierState = {
  id: string | undefined;
  invoiceSupplierContactId: string | undefined;
  invoiceSupplierLocationId: string | undefined;
  currencyCode: string | undefined;
  paymentTermId: string | undefined;
};

/**
 * Owns the PDF auto-fill orchestration for the Purchase Invoice form: resolving
 * the extracted supplier/contact/location/payment-terms/currency against existing
 * records, stashing unmatched values for create-on-the-fly, and re-keying the form
 * with resolved defaults. Keeps this logic out of the presentational form.
 */
export function usePurchaseInvoiceAutoFill(
  initialValues: PurchaseInvoiceFormValues
) {
  const { t } = useLingui();
  const { carbon } = useCarbon();

  const [invoiceSupplier, setInvoiceSupplier] = useState<InvoiceSupplierState>({
    id: initialValues.invoiceSupplierId,
    invoiceSupplierContactId: initialValues.invoiceSupplierContactId,
    invoiceSupplierLocationId: initialValues.invoiceSupplierLocationId,
    currencyCode: initialValues.currencyCode,
    paymentTermId: initialValues.paymentTermId
  });
  const [supplier, setSupplier] = useState<{ id: string | undefined }>({
    id: initialValues.supplierId
  });

  const [extractedLineItems, setExtractedLineItems] = useState<
    PurchaseInvoiceLineItem[]
  >([]);
  const [extractedTaxAmount, setExtractedTaxAmount] = useState<number>(0);
  const [extractedStoragePath, setExtractedStoragePath] = useState<string>();

  const [formKey, setFormKey] = useState(0);
  const [currentValues, setCurrentValues] = useState(initialValues);

  const handleExtractionComplete = async (raw: ExtractedDocumentData) => {
    const data = raw as PurchaseInvoiceExtraction & {
      _storagePath?: string | null;
    };

    // Supplier and payment term are already resolved to real record ids by the
    // extraction job (which was given the candidate lists). Contacts and
    // locations are entity-scoped, so we still match them here against the
    // resolved supplier's records — and simply leave them empty when nothing
    // matches (no forced red-text placeholder).
    const resolvedSupplierId = data.supplierId || currentValues.supplierId;
    let resolvedPaymentTermId =
      data.paymentTermId || currentValues.paymentTermId;
    let resolvedCurrencyCode = data.currencyCode || currentValues.currencyCode;

    let resolvedContactId: string | undefined = undefined;
    let resolvedLocationId: string | undefined = undefined;

    if (carbon && resolvedSupplierId) {
      const { contacts, locations } = await getExtractionMatchCandidates(
        carbon,
        "supplier",
        resolvedSupplierId
      );

      resolvedContactId = findMatchingContactId(contacts, {
        name: data.supplierContactName,
        email: data.supplierContactEmail
      });
      resolvedLocationId = findMatchingLocationId(
        locations,
        data.supplierAddressLine1
      );
    }

    let finalContactId = resolvedContactId;
    let finalLocationId = resolvedLocationId;

    if (
      carbon &&
      resolvedSupplierId &&
      resolvedSupplierId !== invoiceSupplier.id
    ) {
      flushSync(() => {
        setSupplier({ id: resolvedSupplierId });
        setInvoiceSupplier({
          id: resolvedSupplierId,
          currencyCode: resolvedCurrencyCode ?? undefined,
          paymentTermId: resolvedPaymentTermId ?? undefined,
          invoiceSupplierContactId: resolvedContactId,
          invoiceSupplierLocationId: resolvedLocationId
        });
      });

      const [supplierDetails, paymentTermData] = await Promise.all([
        carbon
          .from("supplier")
          .select(
            "currencyCode, purchasingContactId, supplierShipping!supplierShipping_supplierId_fkey(shippingSupplierLocationId)"
          )
          .eq("id", resolvedSupplierId)
          .single(),
        carbon
          .from("supplierPayment")
          .select("*")
          .eq("supplierId", resolvedSupplierId)
          .single()
      ]);

      if (
        supplierDetails &&
        !supplierDetails.error &&
        paymentTermData &&
        !paymentTermData.error
      ) {
        finalContactId =
          resolvedContactId ??
          paymentTermData.data.invoiceSupplierContactId ??
          supplierDetails.data.purchasingContactId ??
          undefined;
        finalLocationId =
          resolvedLocationId ??
          paymentTermData.data.invoiceSupplierLocationId ??
          supplierDetails.data.supplierShipping?.[0]
            ?.shippingSupplierLocationId ??
          undefined;

        resolvedCurrencyCode =
          resolvedCurrencyCode ??
          supplierDetails.data.currencyCode ??
          undefined;
        resolvedPaymentTermId =
          resolvedPaymentTermId ??
          paymentTermData.data.paymentTermId ??
          undefined;

        setInvoiceSupplier((prev) => ({
          ...prev,
          invoiceSupplierContactId: finalContactId,
          invoiceSupplierLocationId: finalLocationId,
          currencyCode: resolvedCurrencyCode,
          paymentTermId: resolvedPaymentTermId
        }));
      }
    } else {
      finalContactId =
        resolvedContactId ?? invoiceSupplier.invoiceSupplierContactId;
      finalLocationId =
        resolvedLocationId ?? invoiceSupplier.invoiceSupplierLocationId;

      setInvoiceSupplier((prev) => ({
        ...prev,
        currencyCode: resolvedCurrencyCode ?? prev.currencyCode,
        paymentTermId: resolvedPaymentTermId ?? prev.paymentTermId,
        invoiceSupplierContactId: finalContactId,
        invoiceSupplierLocationId: finalLocationId
      }));
    }

    setCurrentValues((prev) => ({
      ...prev,
      supplierId: resolvedSupplierId || prev.supplierId,
      invoiceSupplierId: resolvedSupplierId || prev.invoiceSupplierId,
      supplierReference: data.invoiceNumber || prev.supplierReference,
      dateIssued: data.invoiceDate || prev.dateIssued,
      dateDue: data.dueDate || prev.dateDue,
      currencyCode: resolvedCurrencyCode || prev.currencyCode,
      paymentTermId: resolvedPaymentTermId || prev.paymentTermId,
      supplierShippingCost: data.shippingCost || prev.supplierShippingCost,
      invoiceSupplierContactId: finalContactId || prev.invoiceSupplierContactId,
      invoiceSupplierLocationId:
        finalLocationId || prev.invoiceSupplierLocationId
    }));

    if (data.lineItems && Array.isArray(data.lineItems)) {
      setExtractedLineItems(data.lineItems);
    }

    if (data.taxAmount) {
      setExtractedTaxAmount(data.taxAmount);
    }

    if (data._storagePath) {
      setExtractedStoragePath(data._storagePath);
    }

    setFormKey((prev) => prev + 1);
  };

  const onSupplierChange = async (
    newValue: { value: string | undefined } | null
  ) => {
    setSupplier({ id: newValue?.value });
    if (newValue?.value !== invoiceSupplier.id) {
      onInvoiceSupplierChange(newValue);
    }
  };

  const onInvoiceSupplierChange = async (
    newValue: { value: string | undefined } | null
  ) => {
    if (!carbon) {
      toast.error(t`Carbon client not found`);
      return;
    }

    if (newValue?.value) {
      flushSync(() => {
        // update the supplier immediately
        setInvoiceSupplier({
          id: newValue?.value,
          currencyCode: undefined,
          paymentTermId: undefined,
          invoiceSupplierContactId: undefined,
          invoiceSupplierLocationId: undefined
        });
      });

      const [supplierData, paymentTermData] = await Promise.all([
        carbon
          .from("supplier")
          .select(
            "currencyCode, purchasingContactId, supplierShipping!supplierShipping_supplierId_fkey(shippingSupplierLocationId)"
          )
          .eq("id", newValue.value)
          .single(),
        carbon
          .from("supplierPayment")
          .select("*")
          .eq("supplierId", newValue.value)
          .single()
      ]);

      if (supplierData.error || paymentTermData.error) {
        toast.error(t`Error fetching supplier data`);
      } else {
        setInvoiceSupplier((prev) => ({
          ...prev,
          id: newValue.value,
          invoiceSupplierContactId:
            paymentTermData.data.invoiceSupplierContactId ??
            supplierData.data.purchasingContactId ??
            undefined,
          invoiceSupplierLocationId:
            paymentTermData.data.invoiceSupplierLocationId ??
            supplierData.data.supplierShipping?.[0]
              ?.shippingSupplierLocationId ??
            undefined,
          currencyCode: supplierData.data.currencyCode ?? undefined,
          paymentTermId: paymentTermData.data.paymentTermId ?? undefined
        }));
      }
    } else {
      setInvoiceSupplier({
        id: undefined,
        currencyCode: undefined,
        paymentTermId: undefined,
        invoiceSupplierContactId: undefined,
        invoiceSupplierLocationId: undefined
      });
    }
  };

  return {
    supplier,
    invoiceSupplier,
    setInvoiceSupplier,
    currentValues,
    formKey,
    extractedLineItems,
    extractedTaxAmount,
    extractedStoragePath,
    handleExtractionComplete,
    onSupplierChange,
    onInvoiceSupplierChange
  };
}
