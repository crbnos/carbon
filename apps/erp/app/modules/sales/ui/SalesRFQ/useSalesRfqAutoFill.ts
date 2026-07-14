import { useCarbon } from "@carbon/auth";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { flushSync } from "react-dom";
import type { z } from "zod";
import type {
  ExtractedDocumentData,
  SalesRfqExtraction,
  SalesRfqLineItem
} from "~/modules/documents";
import {
  findMatchingContactId,
  findMatchingLocationId,
  getExtractionMatchCandidates
} from "~/modules/documents";
import type { salesRfqValidator } from "../../sales.models";

type SalesRFQFormValues = z.infer<typeof salesRfqValidator>;

type CustomerState = {
  id: string | undefined;
  customerContactId: string | undefined;
  customerEngineeringContactId: string | undefined;
  customerLocationId: string | undefined;
};

/**
 * Owns the PDF auto-fill orchestration for the Sales RFQ form: resolving the
 * extracted customer/contacts/location against existing records, stashing
 * unmatched values for create-on-the-fly, and re-keying the form with the
 * resolved defaults. Keeps this logic out of the presentational form.
 */
export function useSalesRfqAutoFill(initialValues: SalesRFQFormValues) {
  const { t } = useLingui();
  const { carbon } = useCarbon();

  const [customer, setCustomer] = useState<CustomerState>({
    id: initialValues.customerId,
    customerContactId: initialValues.customerContactId,
    customerEngineeringContactId: initialValues.customerEngineeringContactId,
    customerLocationId: initialValues.customerLocationId
  });

  const [extractedLineItems, setExtractedLineItems] = useState<
    SalesRfqLineItem[]
  >([]);
  const [extractedStoragePath, setExtractedStoragePath] = useState<string>();

  const [formKey, setFormKey] = useState(0);
  const [currentValues, setCurrentValues] = useState(initialValues);

  const handleExtractionComplete = async (raw: ExtractedDocumentData) => {
    const data = raw as SalesRfqExtraction & { _storagePath?: string | null };

    // Customer is already resolved to a real record id by the extraction job
    // (which was given the candidate list). Contacts and locations are
    // entity-scoped, so we match them here against the resolved customer's
    // records and leave them empty when nothing matches.
    const resolvedCustomerId = data.customerId || currentValues.customerId;

    let resolvedPurchasingContactId: string | undefined = undefined;
    let resolvedEngineeringContactId: string | undefined = undefined;
    let resolvedLocationId: string | undefined = undefined;

    if (carbon && resolvedCustomerId) {
      const { contacts, locations } = await getExtractionMatchCandidates(
        carbon,
        "customer",
        resolvedCustomerId
      );

      resolvedPurchasingContactId = findMatchingContactId(contacts, {
        name: data.purchasingContactName,
        email: data.purchasingContactEmail
      });
      resolvedEngineeringContactId = findMatchingContactId(contacts, {
        name: data.engineeringContactName,
        email: data.engineeringContactEmail
      });
      resolvedLocationId = findMatchingLocationId(
        locations,
        data.customerAddressLine1
      );
    }

    if (data.lineItems && Array.isArray(data.lineItems)) {
      setExtractedLineItems(data.lineItems);
    }

    if (data._storagePath) {
      setExtractedStoragePath(data._storagePath);
    }

    let finalPurchasingContactId = resolvedPurchasingContactId;
    let finalLocationId = resolvedLocationId;

    if (carbon && resolvedCustomerId && resolvedCustomerId !== customer.id) {
      flushSync(() => {
        setCustomer({
          id: resolvedCustomerId,
          customerContactId: resolvedPurchasingContactId,
          customerEngineeringContactId: resolvedEngineeringContactId,
          customerLocationId: resolvedLocationId
        });
      });

      const { data: customerDetails, error } = await carbon
        .from("customer")
        .select(
          "salesContactId, customerShipping!customerShipping_customerId_fkey(shippingCustomerLocationId)"
        )
        .eq("id", resolvedCustomerId)
        .single();

      if (customerDetails && !error) {
        finalPurchasingContactId =
          resolvedPurchasingContactId ??
          customerDetails.salesContactId ??
          undefined;
        finalLocationId =
          resolvedLocationId ??
          customerDetails.customerShipping?.[0]?.shippingCustomerLocationId ??
          undefined;

        setCustomer((prev) => ({
          ...prev,
          customerContactId: finalPurchasingContactId,
          customerLocationId: finalLocationId
        }));
      }
    } else {
      finalPurchasingContactId =
        resolvedPurchasingContactId ?? customer.customerContactId;
      finalLocationId = resolvedLocationId ?? customer.customerLocationId;

      setCustomer((prev) => ({
        ...prev,
        customerContactId: finalPurchasingContactId,
        customerEngineeringContactId:
          resolvedEngineeringContactId ?? prev.customerEngineeringContactId,
        customerLocationId: finalLocationId
      }));
    }

    setCurrentValues((prev) => ({
      ...prev,
      customerId: resolvedCustomerId || prev.customerId,
      customerReference: data.rfqNumber || prev.customerReference,
      rfqDate: data.rfqDate || prev.rfqDate,
      expirationDate: data.dueDate || prev.expirationDate,
      customerContactId: finalPurchasingContactId || prev.customerContactId,
      customerEngineeringContactId:
        resolvedEngineeringContactId || prev.customerEngineeringContactId,
      customerLocationId: finalLocationId || prev.customerLocationId
    }));

    setFormKey((prev) => prev + 1);
  };

  const onCustomerChange = async (
    newValue: { value: string | undefined } | null
  ) => {
    if (!carbon) {
      toast.error(t`Carbon client not found`);
      return;
    }

    if (newValue?.value) {
      flushSync(() => {
        setCustomer({
          id: newValue?.value,
          customerContactId: undefined,
          customerEngineeringContactId: undefined,
          customerLocationId: undefined
        });
      });

      const { data, error } = await carbon
        .from("customer")
        .select(
          "salesContactId, customerShipping!customerShipping_customerId_fkey(shippingCustomerLocationId)"
        )
        .eq("id", newValue.value)
        .single();
      if (error) {
        toast.error(t`Error fetching customer data`);
      } else {
        setCustomer((prev) => ({
          ...prev,
          customerContactId: data.salesContactId ?? undefined,
          customerLocationId:
            data.customerShipping?.[0]?.shippingCustomerLocationId ?? undefined
        }));
      }
    } else {
      setCustomer({
        id: undefined,
        customerContactId: undefined,
        customerEngineeringContactId: undefined,
        customerLocationId: undefined
      });
    }
  };

  return {
    customer,
    currentValues,
    formKey,
    extractedLineItems,
    extractedStoragePath,
    handleExtractionComplete,
    onCustomerChange
  };
}
