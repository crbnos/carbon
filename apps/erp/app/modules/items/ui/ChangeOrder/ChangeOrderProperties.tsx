import {
  DatePicker,
  InputControlled,
  Select,
  ValidatedForm
} from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  HStack,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useEffect } from "react";
import { LuLink } from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { z } from "zod";
import { Assignee, EmployeeAvatar } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { Combobox } from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import type { ChangeOrderActionTask } from "~/modules/items";
import type { action } from "~/routes/x+/items+/change-order+/update";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import {
  changeOrderPriority,
  isChangeOrderLocked
} from "../../changeOrder.models";
import type { ChangeOrder } from "../../types";
import type { AffectedItemDraft } from "./affectedItem.types";
import ChangeOrderActions from "./ChangeOrderActions";
import { ChangeOrderContentSection } from "./ChangeOrderContent";
import ChangeOrderReleaseMerge from "./ChangeOrderReleaseMerge";
import ImpactPanel, { type ChangeOrderImpactItem } from "./ImpactPanel";
import ItemLink from "./ItemLink";

// One CO-centric section — the xxs uppercase heading + content used by the
// PurchaseOrder / SalesOrder / Quote property sidebars. Sections are separated by
// the container's VStack spacing (whitespace), matching those sidebars exactly.
function PropertiesSection({
  title,
  accessory,
  children
}: {
  title: ReactNode;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  return (
    <VStack spacing={2} className="w-full">
      <HStack className="w-full justify-between">
        <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
          {title}
        </h3>
        {accessory}
      </HStack>
      {children}
    </VStack>
  );
}

// Properties panel (right panel) of the change-order workspace: all CO-centric
// content (not tied to any single affected item), as one consistent sidebar —
// Release (at Implementation), the editable property fields, Details (reason +
// description), Actions, and Impact. Self-contained: reads everything from the
// $id route loader so ResizablePanels can render it with only a `key` (mirrors
// SalesOrderProperties). Owns its own width / scroll / border / padding.
const ChangeOrderProperties = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { t } = useLingui();
  const permissions = usePermissions();

  const routeData = useRouteData<{
    changeOrder: ChangeOrder;
    types: ListItem[];
    affectedItems: AffectedItemDraft[];
    actions: ChangeOrderActionTask[];
    impactUsedIn: ChangeOrderImpactItem[];
    affectedAssemblies: {
      id: string;
      readableIdWithRevision: string | null;
      name: string | null;
    }[];
    nonConformanceOptions: {
      id: string;
      nonConformanceId: string;
      name: string;
    }[];
    linkedNonConformance: {
      id: string;
      nonConformanceId: string;
      name: string;
    } | null;
  }>(path.to.changeOrder(id));

  const changeOrder = routeData?.changeOrder;
  const types = routeData?.types ?? [];
  const affectedItems = routeData?.affectedItems ?? [];
  const actions = routeData?.actions ?? [];
  const impactUsedIn = routeData?.impactUsedIn ?? [];
  const affectedAssemblies = routeData?.affectedAssemblies ?? [];
  const nonConformanceOptions = routeData?.nonConformanceOptions ?? [];
  const linkedNonConformance = routeData?.linkedNonConformance ?? null;
  const isLocked = isChangeOrderLocked(changeOrder?.status);
  const isImplementation = changeOrder?.status === "Implementation";
  const canUpdate = permissions.can("update", "parts");

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: id is stable
  const onUpdate = useCallback(
    (field: string, value: string | null) => {
      const formData = new FormData();
      formData.append("id", id);
      formData.append("field", field);
      formData.append("value", value?.toString() ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.updateChangeOrder
      });
    },
    [id]
  );

  // The read-only changes shown in the release confirmation dialog.
  const changes = affectedItems.map((a) => ({
    id: a.affectedItem.id,
    label: a.affectedItem.item?.readableIdWithRevision ?? a.affectedItem.itemId,
    diff: a.diff
  }));

  return (
    <VStack
      spacing={4}
      className="w-96 flex-shrink-0 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 pt-2 pb-12 text-sm"
    >
      {/* Release is triggered from the header button (opens this confirmation
          dialog via releaseDialogOpenAtom). The dialog is mounted here — headless
          until opened — so it renders nothing in the panel itself. */}
      {isImplementation && changeOrder && (
        <ChangeOrderReleaseMerge
          changeOrderId={id}
          status={changeOrder.status}
          changes={changes}
        />
      )}

      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
            <Trans>Properties</Trans>
          </h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                aria-label={t`Copy link`}
                size="sm"
                className="p-1"
                onClick={() =>
                  copyToClipboard(
                    window.location.origin + path.to.changeOrder(id)
                  )
                }
              >
                <LuLink className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <Trans>Copy link to change order</Trans>
            </TooltipContent>
          </Tooltip>
        </HStack>
        <VStack spacing={1}>
          <span className="text-sm tracking-tight">
            {changeOrder?.changeOrderId}
          </span>
          <ValidatedForm
            defaultValues={{ name: changeOrder?.name ?? undefined }}
            validator={z.object({ name: z.string() })}
            className="w-full"
          >
            <InputControlled
              label=""
              name="name"
              size="sm"
              inline
              isReadOnly={!canUpdate || isLocked}
              value={changeOrder?.name ?? ""}
              onBlur={(e) => {
                onUpdate("name", e.target.value ?? null);
              }}
              className="text-muted-foreground"
            />
          </ValidatedForm>
        </VStack>
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">
          <Trans>Category</Trans>
        </h3>
        <ValidatedForm
          defaultValues={{
            changeOrderTypeId: changeOrder?.changeOrderTypeId ?? ""
          }}
          validator={z.object({ changeOrderTypeId: z.string().optional() })}
          className="w-full"
        >
          <Combobox
            name="changeOrderTypeId"
            label=""
            isReadOnly={!canUpdate || isLocked}
            inline={(value) => (
              <Enumerable
                value={types.find((ty) => ty.id === value)?.name ?? null}
              />
            )}
            options={types.map((ty) => ({ value: ty.id, label: ty.name }))}
            onChange={(value) =>
              onUpdate("changeOrderTypeId", value?.value ?? null)
            }
          />
        </ValidatedForm>
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">
          <Trans>Owner</Trans>
        </h3>
        <Assignee
          id={id}
          table="changeOrder"
          size="sm"
          value={changeOrder?.assignee ?? ""}
          isReadOnly={!canUpdate || isLocked}
        />
      </VStack>

      <ValidatedForm
        defaultValues={{ openDate: changeOrder?.openDate ?? "" }}
        validator={z.object({ openDate: z.string().optional() })}
        className="w-full"
      >
        <DatePicker
          name="openDate"
          label={t`Open Date`}
          inline
          isDisabled={!canUpdate || isLocked}
          onChange={(date) => onUpdate("openDate", date)}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{ priority: changeOrder?.priority ?? "" }}
        validator={z.object({ priority: z.string().optional() })}
        className="w-full"
      >
        <Select
          name="priority"
          label={t`Priority`}
          inline={(value) => <span>{value}</span>}
          isReadOnly={!canUpdate || isLocked}
          options={changeOrderPriority.map((priority) => ({
            value: priority,
            label: priority
          }))}
          onChange={(value) => onUpdate("priority", value?.value ?? null)}
        />
      </ValidatedForm>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">
          <Trans>Linked NCR</Trans>
        </h3>
        <ValidatedForm
          defaultValues={{
            nonConformanceId: changeOrder?.nonConformanceId ?? ""
          }}
          validator={z.object({ nonConformanceId: z.string().optional() })}
          className="w-full"
        >
          <Combobox
            name="nonConformanceId"
            label=""
            isReadOnly={!canUpdate || isLocked}
            inline={(value) => {
              // Chip shows just the NCR id/number — the full name is shown in the
              // link below, so repeating it here only overflows the chip.
              const nonConformanceId =
                linkedNonConformance && linkedNonConformance.id === value
                  ? linkedNonConformance.nonConformanceId
                  : (nonConformanceOptions.find((nc) => nc.id === value)
                      ?.nonConformanceId ?? null);
              return (
                <Enumerable
                  value={nonConformanceId}
                  className="max-w-[140px]"
                />
              );
            }}
            options={nonConformanceOptions.map((nc) => ({
              value: nc.id,
              label: `${nc.nonConformanceId} — ${nc.name}`
            }))}
            onChange={(value) =>
              onUpdate("nonConformanceId", value?.value ?? null)
            }
          />
        </ValidatedForm>
        {changeOrder?.nonConformanceId && (
          <Link
            className="text-xs text-primary hover:underline"
            to={path.to.issue(changeOrder.nonConformanceId)}
          >
            {linkedNonConformance
              ? `${linkedNonConformance.nonConformanceId} — ${linkedNonConformance.name}`
              : changeOrder.nonConformanceId}
          </Link>
        )}
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">
          <Trans>Created By</Trans>
        </h3>
        <EmployeeAvatar employeeId={changeOrder?.createdBy ?? ""} size="xxs" />
      </VStack>

      {/* Affected assemblies — read-only, derived from the distinct assemblies
          referenced by this change order's BOM-change rows (computed in the
          $id loader). */}
      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">
          <Trans>Affected assemblies</Trans>
        </h3>
        {affectedAssemblies.length === 0 ? (
          <span className="text-xs text-muted-foreground italic">
            <Trans>No affected assemblies yet.</Trans>
          </span>
        ) : (
          <VStack spacing={1}>
            {affectedAssemblies.map((assembly) => (
              <ItemLink
                key={assembly.id}
                itemId={assembly.id}
                type={null}
                className="text-sm text-primary"
              >
                {assembly.readableIdWithRevision ??
                  assembly.name ??
                  assembly.id}
              </ItemLink>
            ))}
          </VStack>
        )}
      </VStack>

      <Separator />

      {/* Details — the narrative of the change. Reason + Description are both
          free-text, so they live in one section as labeled sub-fields. */}
      <PropertiesSection title={<Trans>Details</Trans>}>
        <VStack spacing={4} className="w-full">
          <VStack spacing={1} className="w-full">
            <h3 className="text-xs text-muted-foreground">
              <Trans>Reason for change</Trans>
            </h3>
            <ChangeOrderContentSection
              key={`${id}-reason`}
              embedded
              id={id}
              title=""
              field="reasonForChange"
              content={changeOrder?.reasonForChange as JSONContent}
              isDisabled={isLocked}
            />
          </VStack>
          <VStack spacing={1} className="w-full">
            <h3 className="text-xs text-muted-foreground">
              <Trans>Description</Trans>
            </h3>
            <ChangeOrderContentSection
              key={`${id}-description`}
              embedded
              id={id}
              title=""
              field="description"
              content={changeOrder?.description as JSONContent}
              isDisabled={isLocked}
            />
          </VStack>
        </VStack>
      </PropertiesSection>

      <Separator />

      {/* Actions — an editable "Required Actions" multiselect matching the
          Quality issue sidebar; it renders its own label, so no section
          heading. Selecting/deselecting a template adds/removes its task. */}
      <ChangeOrderActions
        variant="summary"
        changeOrderId={id}
        actions={actions}
        isDisabled={isLocked}
      />

      <Separator />

      <PropertiesSection title={<Trans>Impact</Trans>}>
        <ImpactPanel embedded items={impactUsedIn} />
      </PropertiesSection>
    </VStack>
  );
};

export default ChangeOrderProperties;
