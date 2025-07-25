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
import { Hidden, Input, InputControlled, Submit } from "~/components/Form";
import Shape from "~/components/Form/Shape";
import Substance from "~/components/Form/Substance";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { materialTypeValidator } from "../../items.models";

type MaterialTypeFormProps = {
  initialValues: z.infer<typeof materialTypeValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: (data?: { id: string; name: string }) => void;
};

const MaterialTypeForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose,
}: MaterialTypeFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string; name: string }>>();
  const [code, setCode] = useState<string>(initialValues.code);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created material type`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create material type: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

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
            validator={materialTypeValidator}
            method="post"
            action={
              isEditing
                ? path.to.materialType(initialValues.id!)
                : path.to.newMaterialType
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Material Type
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Substance name="materialSubstanceId" label="Substance" />
                <Shape name="materialFormId" label="Shape" />
                <Input name="name" label="Name" />
                <InputControlled
                  name="code"
                  label="Code"
                  value={code}
                  onChange={(value) =>
                    setCode(value.toUpperCase().replace(/\s/g, ""))
                  }
                  helperText="Unique, uppercase, without spaces"
                />
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

export default MaterialTypeForm;