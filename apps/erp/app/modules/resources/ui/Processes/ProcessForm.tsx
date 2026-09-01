import { useControlField, ValidatedForm } from "@carbon/form";
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
import { useEffect } from "react";
import {
  LuCirclePlus,
  LuEllipsisVertical,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import type { z } from "zod";
import { OperationTypeIcon, SupplierAvatar } from "~/components";
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
import { operationTypes } from "~/modules/shared";
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

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent size="lg">
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
                  options={operationTypes.map((pt) => ({
                    value: pt,
                    label: (
                      <span className="flex items-center gap-2">
                        <OperationTypeIcon type={pt} />
                        <span>{pt}</span>
                      </span>
                    )
                  }))}
                />
                {/* Work centers apply to any type (the type is just a default
                    for new operations), but supplier links only make sense for
                    Outside Processing — SupplierProcesses gates itself on it. */}
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
                <SupplierProcesses processId={initialValues.id} />
                <Boolean
                  name="requiresAbility"
                  label={t`Requires Ability`}
                  description={t`Only qualified employees can be scheduled for and run this process`}
                  bordered
                />
                <Boolean
                  name="completeAllOnScan"
                  label={t`Complete all quantities on barcode scan`}
                  description={t`When using kanbans, the complete barcode will complete all quantities of an operation instead of just one`}
                  bordered
                />
                <Boolean
                  name="batchable"
                  label={t`Batchable`}
                  description={t`Multiple jobs can run on this process at the same time — e.g. a laser table, furnace, or plating bath`}
                  bordered
                />
                <BatchCompatibilityRules />
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

// Per-dimension batch compatibility. Only shown once a process is Batchable.
// "Must match" blocks incompatible ops from sharing a batch; "Guide" warns and
// splits suggestion groups; "Ignore" never considers the dimension. Defaults
// (substance/grade/dimension = Guide, the rest = Ignore) reproduce today's
// behavior, so an untouched process behaves exactly as before.
function BatchCompatibilityRules() {
  const { t } = useLingui();
  const [batchable] = useControlField<boolean>("batchable");

  if (!batchable) return null;

  const levelOptions = [
    { value: "must", label: t`Must match` },
    { value: "guide", label: t`Guide` },
    { value: "ignore", label: t`Ignore` }
  ];

  const rules: { name: string; label: string; description: string }[] = [
    {
      name: "batchRuleFinish",
      label: t`Finish`,
      description: t`Surface finish — e.g. anodized vs powder-coat`
    },
    {
      name: "batchRuleSubstance",
      label: t`Substance`,
      description: t`Base material — e.g. steel vs aluminum`
    },
    {
      name: "batchRuleGrade",
      label: t`Grade`,
      description: t`Material grade or alloy designation`
    },
    {
      name: "batchRuleDimension",
      label: t`Dimension`,
      description: t`Stock size — e.g. sheet thickness or bar diameter`
    },
    {
      name: "batchRuleForm",
      label: t`Form`,
      description: t`Material form — e.g. sheet, bar, tube`
    },
    {
      name: "batchRuleItem",
      label: t`Material item`,
      description: t`The exact material part, not just its properties`
    }
  ];

  return (
    <div className="flex flex-col gap-3 w-full rounded-md border border-border p-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">
          <Trans>Compatibility rules</Trans>
        </span>
        <span className="text-xs text-muted-foreground text-pretty">
          <Trans>
            How strictly each material property must match for operations to
            share a batch on this process.
          </Trans>
        </span>
      </div>
      {rules.map((rule) => (
        <div
          key={rule.name}
          className="grid grid-cols-[1fr_10rem] items-center gap-4"
        >
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm">{rule.label}</span>
            <span className="text-xs text-muted-foreground text-pretty">
              {rule.description}
            </span>
          </div>
          <Select
            name={rule.name}
            label=""
            options={levelOptions}
            isOptional={false}
          />
        </div>
      ))}
    </div>
  );
}

function SupplierProcesses({ processId }: { processId?: string }) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const processes = useSupplierProcesses({ processId });
  const navigate = useNavigate();
  const isEditing = processId !== undefined;
  const newSupplierProcessModal = useDisclosure();
  const [processType] = useControlField<string>("processType");

  // Suppliers only apply to outside-processing operations.
  if (processType !== "Outside Processing") return null;

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
