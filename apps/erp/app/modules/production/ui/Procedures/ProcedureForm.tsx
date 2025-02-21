import { ValidatedForm } from "@carbon/form";
import {
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import type { z } from "zod";
import { Hidden, Input, Number, Process, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { procedureValidator } from "../../production.models";

type ProcedureFormProps = {
  initialValues: z.infer<typeof procedureValidator>;
  type: "new" | "copy";
  open?: boolean;
  onClose: (data?: { id: string; name: string }) => void;
};

const ProcedureForm = ({
  initialValues,
  type = "new",
  open = true,
  onClose,
}: ProcedureFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "production")
    : !permissions.can("create", "production");

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={procedureValidator}
            method="post"
            action={
              isEditing
                ? path.to.procedure(initialValues.id!)
                : path.to.newProcedure
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {type === "copy" ? "Copy" : "New"} Procedure
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="copyFromId" />
              {type === "copy" && (
                <>
                  <Hidden name="name" />
                  <Hidden name="processId" />
                  <Hidden name="content" />
                </>
              )}
              <VStack spacing={4}>
                {type === "new" && <Input name="name" label="Name" />}
                <Number
                  name="version"
                  label={type === "copy" ? "New Version" : "Version"}
                  minValue={0}
                  helperText={
                    type === "copy"
                      ? "The new version number of the procedure"
                      : "The version of the new procedure"
                  }
                />
                {type === "new" && (
                  <Process name="processId" label="Process" isOptional />
                )}
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle" || isDisabled}
                >
                  Save
                </Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default ProcedureForm;
