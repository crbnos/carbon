import { ValidatedForm } from "@carbon/form";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  LabelWithHelp,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import {
  LuCirclePlus,
  LuEllipsisVertical,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import type { z } from "zod";
import { SupplierAvatar } from "~/components";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  Input,
  Select,
  StandardFactor,
  Submit
} from "~/components/Form";
import { useSupplierProcesses } from "~/components/Form/SupplierProcess";
import WorkCenters from "~/components/Form/WorkCenters";
import { usePermissions } from "~/hooks";
import { SupplierProcessForm } from "~/modules/purchasing/ui/Supplier";

import { processValidator } from "~/modules/resources";
import { processTypes } from "~/modules/shared";
import { path } from "~/utils/path";

type ProcessFormProps = {
  initialValues: z.infer<typeof processValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const ProcessForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: ProcessFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(t`Created process`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(t`Failed to create process: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, type, t]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  const [processType, setProcessType] = useState(initialValues.processType);

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
            validator={processValidator}
            method="post"
            action={
              isEditing
                ? path.to.process(initialValues.id!)
                : path.to.newProcess
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? (
                  <Trans>Edit Process</Trans>
                ) : (
                  <Trans>New Process</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label={t`Process Name`} />
                <Select
                  name="processType"
                  label={t`Process Type`}
                  termId="process-type"
                  options={processTypes.map((pt) => ({
                    value: pt,
                    label: pt
                  }))}
                  onChange={(newValue) => {
                    setProcessType(
                      newValue?.value as (typeof processTypes)[number]
                    );
                  }}
                />
                {processType !== "Outside" && (
                  <>
                    <StandardFactor
                      name="defaultStandardFactor"
                      label={t`Default Unit`}
                      termId="process-default-unit"
                      value={initialValues.defaultStandardFactor}
                    />
                    <WorkCenters
                      name="workCenters"
                      label={t`Work Centers`}
                      termId="work-center"
                    />
                  </>
                )}
                {processType !== "Inside" && (
                  <SupplierProcesses processId={initialValues.id} />
                )}
                <Boolean
                  name="completeAllOnScan"
                  label={t`Complete all quantities on barcode scan`}
                  termId="process-complete-all-on-scan"
                />
                <CustomFormFields table="process" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default ProcessForm;

function SupplierProcesses({ processId }: { processId?: string }) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const processes = useSupplierProcesses({ processId });
  const navigate = useNavigate();
  const isEditing = processId !== undefined;
  const newSupplierProcessModal = useDisclosure();

  return (
    <>
      <div className="flex flex-col gap-2 w-full">
        {processes.length > 0 && (
          <>
            <label className="text-muted-foreground text-xs">
              <LabelWithHelp termId="process-suppliers">
                {t`Suppliers`}
              </LabelWithHelp>
            </label>
            {processes.map((sp) => (
              <HStack
                key={sp.id}
                className="w-full justify-between rounded-md border border-border p-2 text-sm"
              >
                <SupplierAvatar supplierId={sp.supplierId} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label={t`Edit supplier process`}
                      icon={<LuEllipsisVertical />}
                      size="md"
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onClick={() =>
                        navigate(
                          path.to.supplierProcess(sp.supplierId!, sp.id!)
                        )
                      }
                      disabled={!permissions.can("update", "purchasing")}
                    >
                      <DropdownMenuIcon icon={<LuPencil />} />
                      <Trans>Edit Process</Trans>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        navigate(
                          path.to.deleteSupplierProcess(sp.supplierId!, sp.id!)
                        )
                      }
                      disabled={!permissions.can("delete", "purchasing")}
                    >
                      <DropdownMenuIcon icon={<LuTrash />} />
                      <Trans>Delete Process</Trans>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </HStack>
            ))}
          </>
        )}
        <Button
          isDisabled={!isEditing}
          leftIcon={<LuCirclePlus />}
          variant="secondary"
          onClick={newSupplierProcessModal.onOpen}
        >
          <Trans>Add Supplier</Trans>
        </Button>
      </div>
      {newSupplierProcessModal.isOpen && processId && (
        <SupplierProcessForm
          type="modal"
          onClose={() => {
            newSupplierProcessModal.onClose();
          }}
          initialValues={{
            processId: processId,
            supplierId: "",
            minimumCost: 0,
            leadTime: 0
          }}
        />
      )}
    </>
  );
}
