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
import { useEffect } from "react";
import type { z } from "zod";
import { Hidden, Input, Submit } from "~/components/Form";
import Substance from "~/components/Form/Substance";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { materialGradeValidator } from "../../items.models";

type MaterialGradeFormProps = {
  initialValues: z.infer<typeof materialGradeValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: (data?: { id: string; name: string }) => void;
};

const MaterialGradeForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose,
}: MaterialGradeFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string; name: string }>>();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created material grade`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create material grade: ${fetcher.data.error.message}`
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
            validator={materialGradeValidator}
            method="post"
            action={
              isEditing
                ? path.to.materialGrade(initialValues.id!)
                : path.to.newMaterialGrade
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Material Grade
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Substance name="materialSubstanceId" label="Substance" />
                <Input name="name" label="Name" />
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

export default MaterialGradeForm;
