// Create/edit drawer for Item Rules. Mirrors
// `~/modules/inventory/ui/StorageRules/StorageRuleForm` minus targetType/appliesToAll —
// item rules are always item-target and broadcast via the item filters.
// Reuses the shared storage-rules builder components, parameterized with the
// item-rule surface catalog + field pool.

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
  getFieldsForItemRuleSurfaces,
  ITEM_RULE_SURFACES,
  type ItemRuleSurface
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuFileText, LuShoppingCart } from "react-icons/lu";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import ItemFilterSelector from "~/modules/inventory/ui/StorageRules/ItemFilterSelector";
import MessageWithTokens from "~/modules/inventory/ui/StorageRules/MessageWithTokens";
import RuleBuilder from "~/modules/inventory/ui/StorageRules/RuleBuilder";
import SeveritySelect from "~/modules/inventory/ui/StorageRules/SeveritySelect";
import SurfacesField from "~/modules/inventory/ui/StorageRules/SurfacesField";
import { path } from "~/utils/path";
import { itemRuleValidator } from "../../items.models";

const ITEM_RULE_SURFACE_OPTIONS: {
  value: ItemRuleSurface;
  label: string;
  description?: string;
  icon?: JSX.Element;
}[] = [
  {
    value: "quoteLine",
    label: "Quote line",
    description: "When an item is added to a quote",
    icon: <LuFileText />
  },
  {
    value: "salesOrderLine",
    label: "Sales order line",
    description: "When an item is added to a sales order",
    icon: <LuShoppingCart />
  }
];

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
  // callback. MessageWithTokens reads it to offer per-condition tokens.
  const [liveConditions, setLiveConditions] = useState<Condition[]>(
    conditionAstInitial.conditions
  );

  // Default new rules to all item-rule surfaces. Editing keeps whatever was
  // saved.
  const defaultSurfaces = (initialValues.surfaces ?? [
    ...ITEM_RULE_SURFACES
  ]) as ItemRuleSurface[];

  const [liveSurfaces, setLiveSurfaces] =
    useState<ItemRuleSurface[]>(defaultSurfaces);

  // Field pool the builder + token dropdown may reference, narrowed by the
  // rule's live surfaces (mirrors the save-time validator gate).
  const itemRuleFields = useMemo(
    () => getFieldsForItemRuleSurfaces(liveSurfaces),
    [liveSurfaces]
  );

  const defaults = {
    id: initialValues.id ?? undefined,
    name: initialValues.name ?? "",
    description: initialValues.description ?? "",
    message: initialValues.message ?? "",
    severity: initialValues.severity ?? "error",
    filteredItemTypes: initialValues.filteredItemTypes ?? [],
    filteredItemGroupIds: initialValues.filteredItemGroupIds ?? [],
    filteredItemMatchAll: initialValues.filteredItemMatchAll ?? false,
    active: initialValues.active ?? true,
    surfaces: defaultSurfaces
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
                <ItemFilterSelector />
                <SurfacesField<ItemRuleSurface>
                  name="surfaces"
                  surfaceOptions={ITEM_RULE_SURFACE_OPTIONS}
                  onSurfacesChange={setLiveSurfaces}
                />
                <RuleBuilder
                  name="conditionAst"
                  initial={conditionAstInitial}
                  onConditionsChange={setLiveConditions}
                  fields={itemRuleFields}
                />
                <MessageWithTokens
                  name="message"
                  conditions={liveConditions}
                  fields={itemRuleFields}
                />
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
