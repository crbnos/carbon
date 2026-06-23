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
  VStack
} from "@carbon/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  CostCenter,
  CustomFormFields,
  Employee,
  Hidden,
  Input,
  Submit
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { costCenterValidator } from "../../accounting.models";

type CostCenterFormProps = {
  initialValues: z.infer<typeof costCenterValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const CostCenterForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: CostCenterFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();
  const routeData = useRouteData<{
    purchaseOrderApprovalsActive: boolean;
  }>(path.to.costCenters);
  const approvalsActive = routeData?.purchaseOrderApprovalsActive ?? false;

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created cost center`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create cost center: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

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
            validator={costCenterValidator}
            method="post"
            action={
              isEditing
                ? path.to.costCenter(initialValues.id!)
                : path.to.newCostCenter
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Cost Center
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label="Cost Center Name" />
                <CostCenter
                  name="parentCostCenterId"
                  label="Parent Cost Center"
                  termId="parent-cost-center"
                />
                <Employee
                  name="ownerId"
                  label="Owner"
                  termId="cost-center-owner"
                  isOptional={!approvalsActive}
                />
                <CustomFormFields table="costCenter" />
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

export default CostCenterForm;
