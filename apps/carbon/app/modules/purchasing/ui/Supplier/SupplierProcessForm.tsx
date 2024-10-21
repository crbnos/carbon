import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  toast,
  VStack,
} from "@carbon/react";
import { useFetcher, useNavigate, useParams } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Number,
  Process,
  Submit,
  Supplier,
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import type { SupplierProcess } from "~/modules/purchasing";
import { supplierProcessValidator } from "~/modules/purchasing";
import { path } from "~/utils/path";

type SupplierProcessFormProps = {
  initialValues: z.infer<typeof supplierProcessValidator>;
  type?: "drawer" | "modal";
  open?: boolean;
  onClose: () => void;
};

const SupplierProcessForm = ({
  initialValues,
  type = "drawer",
  open = true,
  onClose,
}: SupplierProcessFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<SupplierProcess>>();
  const { supplierId } = useParams();
  const [supplier, setSupplier] = useState<string | undefined>(supplierId);
  const navigate = useNavigate();

  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      // @ts-ignore
      toast.success(`Created supplier process`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to create supplier process`);
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "purchasing")
    : !permissions.can("create", "purchasing");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            if (type === "modal") {
              onClose?.();
            } else {
              navigate(-1);
            }
          }
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={supplierProcessValidator}
            method="post"
            action={
              isEditing
                ? path.to.supplierProcess(supplier!, initialValues.id!)
                : path.to.newSupplierProcess(supplier!)
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Supplier Process
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              {supplierId && <Hidden name="supplierId" value={supplierId} />}
              <VStack spacing={4}>
                {supplierId === undefined && (
                  <Supplier
                    name="supplierId"
                    label="Supplier"
                    onChange={(newValue) => setSupplier(newValue?.value)}
                  />
                )}
                <Process name="processId" label="Process" />
                <Number
                  name="minimumCost"
                  label="Minimum Cost"
                  formatOptions={{
                    style: "currency",
                    currency: baseCurrency,
                  }}
                  minValue={0}
                />
                <Number
                  name="unitCost"
                  label="Unit Cost"
                  formatOptions={{
                    style: "currency",
                    currency: baseCurrency,
                  }}
                  minValue={0}
                />
                <Number name="leadTime" label="Lead Time" minValue={0} />

                <CustomFormFields table="supplierProcess" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  Cancel
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default SupplierProcessForm;
