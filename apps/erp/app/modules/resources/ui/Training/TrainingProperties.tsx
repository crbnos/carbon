import { Select, ValidatedForm } from "@carbon/form";
import {
  Badge,
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
import { LuCopy, LuKeySquare, LuLink } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import Assignee, { useOptimisticAssignment } from "~/components/Assignee";
import { Enumerable } from "~/components/Enumerable";
import { Ability, InputControlled, Tags } from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { useTags } from "~/hooks/useTags";
import type { Training } from "~/modules/resources";
import {
  trainingFrequency,
  trainingStatus,
  trainingType
} from "~/modules/resources";
import type { action } from "~/routes/x+/items+/update";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import TrainingStatus from "./TrainingStatus";

const TrainingProperties = () => {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    training: Training;
    tags: Array<{ name: string }>;
  }>(path.to.training(id));

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdate = useCallback(
    (
      field:
        | "name"
        | "status"
        | "type"
        | "frequency"
        | "estimatedDuration"
        | "description"
        | "grantsAbilityId",
      value: string | null
    ) => {
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("field", field);
      formData.append("value", value?.toString() ?? "");

      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateTraining
      });
    },

    [id]
  );

  const optimisticAssignment = useOptimisticAssignment({
    id: id,
    table: "training"
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.training?.assignee;

  const permissions = usePermissions();

  const { onUpdateTags } = useTags({ id, table: "training" });

  const availableTags = routeData?.tags ?? [];

  return (
    <VStack
      spacing={4}
      className="w-[450px] bg-background/30 h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
            <Trans>Properties</Trans>
          </h3>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Link"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(
                      window.location.origin + path.to.training(id)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy link to training</Trans>
                </span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Copy"
                  size="sm"
                  className="p-1"
                  onClick={() => copyToClipboard(routeData?.training?.id ?? "")}
                >
                  <LuKeySquare className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy training unique identifier</Trans>
                </span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Copy"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(routeData?.training?.name ?? "")
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy training name</Trans>
                </span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm tracking-tight">
          {routeData?.training?.name}
        </span>
      </VStack>

      <Assignee
        id={id}
        table="training"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={!permissions.can("update", "resources")}
      />

      <ValidatedForm
        defaultValues={{
          status: routeData?.training?.status ?? undefined
        }}
        validator={z.object({
          status: z.string().min(1, { message: "Status is required" })
        })}
        className="w-full"
      >
        <span className="text-sm tracking-tight">
          <Select
            label={t`Status`}
            name="status"
            inline={(value) => (
              <TrainingStatus
                status={value as "Draft" | "Active" | "Archived"}
              />
            )}
            options={trainingStatus.map((status) => ({
              value: status,
              label: <TrainingStatus status={status} />
            }))}
            value={routeData?.training?.status ?? ""}
            onChange={(value) => {
              onUpdate("status", value?.value ?? null);
            }}
          />
        </span>
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          type: routeData?.training?.type ?? undefined
        }}
        validator={z.object({
          type: z.string().min(1, { message: "Type is required" })
        })}
        className="w-full"
      >
        <span className="text-sm tracking-tight">
          <Select
            label={t`Type`}
            name="type"
            inline={(value) => (
              <Badge variant={value === "Mandatory" ? "default" : "secondary"}>
                {value}
              </Badge>
            )}
            options={trainingType.map((t) => ({
              value: t,
              label: (
                <Badge variant={t === "Mandatory" ? "default" : "secondary"}>
                  {t}
                </Badge>
              )
            }))}
            value={routeData?.training?.type ?? ""}
            onChange={(value) => {
              onUpdate("type", value?.value ?? null);
            }}
          />
        </span>
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          frequency: routeData?.training?.frequency ?? undefined
        }}
        validator={z.object({
          frequency: z.string().min(1, { message: "Frequency is required" })
        })}
        className="w-full"
      >
        <span className="text-sm tracking-tight">
          <Select
            label={t`Frequency`}
            name="frequency"
            inline={(value) => <Badge variant="secondary">{value}</Badge>}
            options={trainingFrequency.map((f) => ({
              value: f,
              label: <Badge variant="secondary">{f}</Badge>
            }))}
            value={routeData?.training?.frequency ?? ""}
            onChange={(value) => {
              onUpdate("frequency", value?.value ?? null);
            }}
          />
        </span>
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          estimatedDuration: routeData?.training?.estimatedDuration ?? undefined
        }}
        validator={z.object({
          estimatedDuration: z.string()
        })}
        className="w-full -mt-2"
      >
        <span className="text-xs text-muted-foreground">
          <InputControlled
            label={t`Estimated Duration`}
            name="estimatedDuration"
            inline
            placeholder="45m"
            size="sm"
            value={routeData?.training?.estimatedDuration ?? ""}
            onBlur={(e) => {
              onUpdate("estimatedDuration", e.target.value ?? null);
            }}
            className="text-muted-foreground"
          />
        </span>
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          grantsAbilityId: routeData?.training?.grantsAbilityId ?? undefined
        }}
        validator={z.object({
          grantsAbilityId: z.string().optional()
        })}
        className="w-full"
      >
        <span className="text-sm tracking-tight">
          <Ability
            label={t`Grants Ability`}
            name="grantsAbilityId"
            inline={(value, options) => {
              const label = options.find((o) => o.value === value)?.label;
              return typeof label === "string" ? (
                <Enumerable value={label} />
              ) : (
                <span className="text-muted-foreground">
                  <Trans>None</Trans>
                </span>
              );
            }}
            value={routeData?.training?.grantsAbilityId ?? ""}
            onChange={(value) => {
              onUpdate("grantsAbilityId", value?.value ?? null);
            }}
            isReadOnly={!permissions.can("update", "people")}
          />
        </span>
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          tags: routeData?.training?.tags ?? []
        }}
        validator={z.object({
          tags: z.array(z.string()).optional()
        })}
        className="w-full"
      >
        <Tags
          label={t`Tags`}
          name="tags"
          table="training"
          availableTags={availableTags}
          onChange={(value) => onUpdateTags(value)}
          inline
        />
      </ValidatedForm>
    </VStack>
  );
};

export default TrainingProperties;
