import { DatePicker, Select, ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect } from "react";
import { LuLink } from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { z } from "zod";
import { Assignee, EmployeeAvatar } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { Combobox } from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import type { action } from "~/routes/x+/items+/change-order+/update";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import {
  changeOrderPriority,
  isChangeOrderLocked
} from "../../changeOrder.models";
import type { ChangeOrder } from "../../types";
import ItemLink from "./ItemLink";

const ChangeOrderProperties = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { t } = useLingui();
  const permissions = usePermissions();

  const routeData = useRouteData<{
    changeOrder: ChangeOrder;
    types: ListItem[];
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
  const affectedAssemblies = routeData?.affectedAssemblies ?? [];
  const nonConformanceOptions = routeData?.nonConformanceOptions ?? [];
  const linkedNonConformance = routeData?.linkedNonConformance ?? null;
  const isLocked = isChangeOrderLocked(changeOrder?.status);
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

  return (
    <VStack
      spacing={4}
      // Width / scroll / background / border / padding are owned by the
      // containing ChangeOrderRail; this panel just flows inside it as a section.
      className="w-full"
    >
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
        <span className="text-sm tracking-tight">
          {changeOrder?.changeOrderId}
        </span>
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
              const label =
                linkedNonConformance && linkedNonConformance.id === value
                  ? `${linkedNonConformance.nonConformanceId} — ${linkedNonConformance.name}`
                  : (nonConformanceOptions.find((nc) => nc.id === value)
                      ?.nonConformanceId ?? null);
              return <Enumerable value={label} />;
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
    </VStack>
  );
};

export default ChangeOrderProperties;
