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
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  Employee,
  Hidden,
  Location,
  Number,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { cutListValidator, dimensionUnits } from "../../production.models";

type CuttingProcess = {
  id: string;
  name: string;
  defaultKerf: number | null;
  defaultEndTrim: number | null;
  defaultGripMargin: number | null;
  defaultMinRemnantLength: number | null;
};

type CutListFormProps = {
  initialValues: z.infer<typeof cutListValidator>;
  processes: CuttingProcess[];
  type?: "modal" | "drawer";
  onClose?: () => void;
};

const CutListForm = ({
  initialValues,
  processes,
  type = "drawer",
  onClose
}: CutListFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{ id: string }>();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "production")
    : !permissions.can("create", "production");

  // Saw parameters default from the machine, but stay editable — a worn blade
  // cuts a wider kerf than the process default says.
  const [params, setParams] = useState({
    kerf: initialValues.kerf ?? 0,
    endTrim: initialValues.endTrim ?? 0,
    gripMargin: initialValues.gripMargin ?? 0,
    minRemnantLength: initialValues.minRemnantLength ?? 0
  });

  const onProcessChange = (processId?: string) => {
    const process = processes.find((p) => p.id === processId);
    if (!process) return;
    setParams({
      kerf: process.defaultKerf ?? 0,
      endTrim: process.defaultEndTrim ?? 0,
      gripMargin: process.defaultGripMargin ?? 0,
      minRemnantLength: process.defaultMinRemnantLength ?? 0
    });
  };

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={cutListValidator}
            method="post"
            action={
              isEditing
                ? path.to.cutList(initialValues.id!)
                : path.to.newCutList
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? t`Edit Cut List` : t`New Cut List`}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <Select
                  name="processId"
                  label={t`Cutting Process`}
                  isClearable
                  options={processes.map((p) => ({
                    value: p.id,
                    label: p.name
                  }))}
                  onChange={(value) =>
                    onProcessChange(value?.value as string | undefined)
                  }
                  helperText={
                    processes.length === 0
                      ? t`No cutting processes yet — mark a process as a cutting process in Resources.`
                      : undefined
                  }
                />
                <Location name="locationId" label={t`Location`} isClearable />
                <Select
                  name="unitOfDimension"
                  label={t`Unit`}
                  options={dimensionUnits.map((u) => ({
                    value: u,
                    label: u
                  }))}
                />
                <Number
                  name="kerf"
                  label={t`Kerf`}
                  minValue={0}
                  value={params.kerf}
                  onChange={(value) =>
                    setParams((p) => ({ ...p, kerf: value }))
                  }
                  helperText={t`Material the blade destroys on every cut`}
                />
                <Number
                  name="endTrim"
                  label={t`End trim`}
                  minValue={0}
                  value={params.endTrim}
                  onChange={(value) =>
                    setParams((p) => ({ ...p, endTrim: value }))
                  }
                  helperText={t`Cut off the end of a new stock unit before the first piece`}
                />
                <Number
                  name="gripMargin"
                  label={t`Grip margin`}
                  minValue={0}
                  value={params.gripMargin}
                  onChange={(value) =>
                    setParams((p) => ({ ...p, gripMargin: value }))
                  }
                  helperText={t`Length the clamp holds and cannot cut`}
                />
                <Number
                  name="minRemnantLength"
                  label={t`Minimum remnant`}
                  minValue={0}
                  value={params.minRemnantLength}
                  onChange={(value) =>
                    setParams((p) => ({ ...p, minRemnantLength: value }))
                  }
                  helperText={t`Shorter drops are scrapped instead of returned to stock`}
                />
                <Employee name="assignee" label={t`Assignee`} isClearable />
                <CustomFormFields table="cutList" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>{t`Save`}</Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  {t`Cancel`}
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default CutListForm;
