import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Heading,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { useEffect } from "react";
import { LuMailX } from "react-icons/lu";
import { useFetcher } from "react-router";
import { SupplierContact } from "~/components/Form";
import { useIntegrations } from "~/hooks/useIntegrations";
import { path } from "~/utils/path";
import { purchasingRfqFinalizeValidator } from "../../purchasing.models";
import type { PurchasingRFQLine } from "../../types";

type FinalizeRFQModalProps = {
  rfqId: string;
  lines: PurchasingRFQLine[];
  suppliers: {
    id: string;
    supplierId: string;
    supplier: { id: string; name: string };
  }[];
  onClose: () => void;
};

const FinalizeRFQModal = ({
  rfqId,
  lines,
  suppliers,
  onClose
}: FinalizeRFQModalProps) => {
  const integrations = useIntegrations();
  const canEmail = integrations.has("resend");
  const fetcher = useFetcher<{ error: string | null }>();
  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "loading") {
      onClose();
    }
  }, [fetcher.state, onClose]);

  // Build default values with all suppliers
  const defaultValues = {
    suppliers: suppliers.map((s) => ({
      supplierId: s.supplierId,
      rfqSupplierId: s.id,
      contactId: ""
    }))
  };

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
        <ValidatedForm
          method="post"
          validator={purchasingRfqFinalizeValidator}
          action={path.to.purchasingRfqFinalize(rfqId)}
          onSubmit={onClose}
          defaultValues={defaultValues}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>Send RFQ to Suppliers</ModalTitle>
            <ModalDescription>
              Create supplier quotes and send quote requests to the selected
              suppliers.
            </ModalDescription>
          </ModalHeader>

          <ModalBody>
            <VStack spacing={4}>
              {!canEmail ? (
                <Alert variant="warning">
                  <LuMailX className="h-4 w-4" />
                  <AlertTitle>Email notifications not configured</AlertTitle>
                  <AlertDescription>
                    Configure the Resend integration to enable email
                    notifications. Supplier quotes will still be created and you
                    can share links manually.
                  </AlertDescription>
                </Alert>
              ) : null}
              <VStack spacing={4} className="w-full">
                {suppliers.map((supplier, index) => (
                  <VStack
                    key={supplier.id}
                    spacing={2}
                    className="w-full p-4 border rounded-lg"
                  >
                    <HStack className="w-full justify-between">
                      <Heading size="h4" as="h3">
                        {supplier.supplier.name}
                      </Heading>
                    </HStack>

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

                    {canEmail && (
                      <SupplierContact
                        name={`suppliers[${index}].contactId`}
                        supplier={supplier.supplierId}
                        label="Contact (optional)"
                      />
                    )}
                  </VStack>
                ))}
              </VStack>

              <div className="text-sm text-muted-foreground">
                {lines.length} line item{lines.length !== 1 ? "s" : ""} will be
                included in each supplier quote.
              </div>
            </VStack>
          </ModalBody>

          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" isDisabled={isLoading} isLoading={isLoading}>
              Send to {suppliers.length} Supplier
              {suppliers.length !== 1 ? "s" : ""}
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default FinalizeRFQModal;
