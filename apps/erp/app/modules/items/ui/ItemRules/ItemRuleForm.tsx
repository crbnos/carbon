import { Boolean, ValidatedForm } from "@carbon/form";
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
import {
  type Condition,
  type ConditionAst,
  TRANSACTION_SURFACES
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { itemRuleValidator } from "../../items.models";
import MessageWithTokens from "./MessageWithTokens";
import RuleBuilder from "./RuleBuilder";
import SeveritySelect from "./SeveritySelect";
import SurfacesField from "./SurfacesField";

type ItemRuleFormInitial = Partial<z.infer<typeof itemRuleValidator>> & {
  conditionAst?: ConditionAst;
};

type ItemRuleFormProps = {
  initialValues: ItemRuleFormInitial;
  open?: boolean;
  onClose: () => void;
};

export default function ItemRuleForm({
  initialValues,
  open = true,
  onClose
}: ItemRuleFormProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();

  const isEditing = !!initialValues.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  const conditionAstInitial: ConditionAst = (initialValues.conditionAst as
    | ConditionAst
    | undefined) ?? {
    kind: "all",
    conditions: []
  };

  // Live mirror of the AST conditions, kept in sync via RuleBuilder's
  // callback. MessageWithTokens reads it to offer per-condition tokens
  // (`{condition[0].value}`, etc.) that resolve to the rule's required
  // value at eval time — independent of the runtime ctx.
  const [liveConditions, setLiveConditions] = useState<Condition[]>(
    conditionAstInitial.conditions
  );

  // ValidatedForm wants defaultValues; we hand it the scalar fields.
  // conditionAst gets driven by RuleBuilder via Hidden field.
  const defaults = {
    id: initialValues.id ?? undefined,
    name: initialValues.name ?? "",
    description: initialValues.description ?? "",
    message: initialValues.message ?? "",
    severity: initialValues.severity ?? "error",
    active: initialValues.active ?? true,
    // Default new rules to all surfaces (matches DB default).
    surfaces: initialValues.surfaces ?? [...TRANSACTION_SURFACES]
  };

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open={open}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
      >
        <ModalDrawerContent size="lg">
          <ValidatedForm
            validator={itemRuleValidator}
            method="post"
            action={
              isEditing
                ? path.to.itemRule(initialValues.id!)
                : path.to.newItemRule
            }
            defaultValues={defaults}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? <Trans>Edit rule</Trans> : <Trans>New rule</Trans>}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <HStack className="w-full gap-x-4">
                  <Input name="name" label={t`Name`} />

                  <div className="shrink-0 pb-2">
                    <Boolean variant="large" name="active" label={t`Active`} />
                  </div>
                </HStack>
                <TextArea
                  name="description"
                  label={t`Description`}
                  placeholder={t`Optional context for this rule`}
                />
                <SeveritySelect name="severity" />
                <SurfacesField name="surfaces" />
                <RuleBuilder
                  name="conditionAst"
                  initial={conditionAstInitial}
                  onConditionsChange={setLiveConditions}
                />
                <MessageWithTokens name="message" conditions={liveConditions} />
                <CustomFormFields table="itemRule" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
                <Button variant="solid" onClick={() => onClose()}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
}
