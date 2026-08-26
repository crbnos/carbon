// Create/edit drawer for Sales Rules. Mirrors
// `~/modules/inventory/ui/StorageRules/StorageRuleForm` minus targetType/appliesToAll —
// sales rules are always item-target and broadcast via the item filters.
// Reuses the shared storage-rules builder components, parameterized with the
// sales-rule surface catalog + field pool.

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
  getFieldsForSalesRuleSurfaces,
  SALES_RULE_SURFACES,
  type SalesRuleSurface
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuFileText, LuReceipt, LuShoppingCart } from "react-icons/lu";
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
import { salesRuleValidator } from "../../sales.models";

const SALES_RULE_SURFACE_OPTIONS: {
  value: SalesRuleSurface;
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
  },
  {
    value: "salesInvoiceLine",
    label: "Sales invoice line",
    description: "When an item is added to a sales invoice",
    icon: <LuReceipt />
  }
];

type SalesRuleFormInitial = Partial<z.infer<typeof salesRuleValidator>> & {
  conditionAst?: ConditionAst;
};

type SalesRuleFormProps = {
  initialValues: SalesRuleFormInitial;
  open?: boolean;
  onClose: () => void;
};

export default function SalesRuleForm({
  initialValues,
  open = true,
  onClose
}: SalesRuleFormProps) {
  const { t } = useLingui();
  const permissions = usePermissions();

  const isEditing = !!initialValues.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

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

  // Default new rules to all sales-rule surfaces. Editing keeps whatever was
  // saved.
  const defaultSurfaces = (initialValues.surfaces ?? [
    ...SALES_RULE_SURFACES
  ]) as SalesRuleSurface[];

  const [liveSurfaces, setLiveSurfaces] =
    useState<SalesRuleSurface[]>(defaultSurfaces);

  // Field pool the builder + token dropdown may reference, narrowed by the
  // rule's live surfaces (mirrors the save-time validator gate).
  const salesRuleFields = useMemo(
    () => getFieldsForSalesRuleSurfaces(liveSurfaces),
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
            validator={salesRuleValidator}
            method="post"
            action={
              isEditing
                ? path.to.salesRule(initialValues.id!)
                : path.to.newSalesRule
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
                <SurfacesField<SalesRuleSurface>
                  name="surfaces"
                  surfaceOptions={SALES_RULE_SURFACE_OPTIONS}
                  onSurfacesChange={setLiveSurfaces}
                />
                <RuleBuilder
                  name="conditionAst"
                  initial={conditionAstInitial}
                  onConditionsChange={setLiveConditions}
                  fields={salesRuleFields}
                />
                <MessageWithTokens
                  name="message"
                  conditions={liveConditions}
                  fields={salesRuleFields}
                />
                <CustomFormFields table="enforcementRule" />
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
