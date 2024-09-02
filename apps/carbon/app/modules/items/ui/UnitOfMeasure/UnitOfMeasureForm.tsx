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
  VStack,
  toast,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  InputControlled,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { unitOfMeasureValidator } from "~/modules/items";
import { path } from "~/utils/path";

type UnitOfMeasureFormProps = {
  initialValues: z.infer<typeof unitOfMeasureValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: (data?: { id: string; name: string }) => void;
};

const UnitOfMeasureForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose,
}: UnitOfMeasureFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();
  const [code, setCode] = useState<string>(initialValues.code);

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created unit of measure`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create unit of measure: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={unitOfMeasureValidator}
            method="post"
            action={isEditing ? path.to.uom(initialValues.id!) : path.to.newUom}
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Unit of Measure
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label="Unit of Measure" />
                <InputControlled
                  name="code"
                  label="Code"
                  value={code}
                  onChange={(value) =>
                    setCode(value.toUpperCase().replace(/\s/g, ""))
                  }
                  helperText="Unique, uppercase, without spaces"
                />
                <CustomFormFields table="unitOfMeasure" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={() => onClose()}>
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

export default UnitOfMeasureForm;
