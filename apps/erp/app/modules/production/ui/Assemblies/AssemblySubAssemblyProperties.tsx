// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Hidden, Input, Submit, ValidatedForm } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  Label,
  LabelWithHelp,
  Subheading,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import type { AssemblyStep, SubAssemblyInfo } from "@carbon/viewer";
import { usableSubAssemblies } from "@carbon/viewer";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuChevronDown, LuTrash, LuUngroup } from "react-icons/lu";
import { useFetcher, useParams, useSearchParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { useImageUpload, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { assemblyInstructionStepValidator } from "../../production.models";
import type { AssemblyInstructionStepRow } from "../../types";
import PlaybackRow from "./AssemblyPlaybackRow";
import { SUB_ASSEMBLY_PARAM } from "./AssemblyStepList";

type AssemblySubAssemblyPropertiesProps = {
  step: AssemblyInstructionStepRow;
  /** Every step of the instruction, in play order */
  viewerSteps: AssemblyStep[];
  subPlan: Map<string, SubAssemblyInfo>;
  titleOf: (stepId: string) => string;
  isDisabled: boolean;
  itemMentions: { id: string; label: string; helper?: string }[];
  onSelectStep: (stepId: string) => void;
  onSetCamera: (stepId: string) => void;
  onClearCamera: (stepId: string) => void;
};

/**
 * Properties of a selected sub-assembly (a header row): its name, its steps,
 * the step that uses it, and — when nothing uses it — how it joins the main
 * build (instruction + camera). Ungroup and delete live here too.
 */
export default function AssemblySubAssemblyProperties({
  step,
  viewerSteps,
  subPlan,
  titleOf,
  isDisabled,
  itemMentions,
  onSelectStep,
  onSetCamera,
  onClearCamera
}: AssemblySubAssemblyPropertiesProps) {
  const { id: instructionId } = useParams();
  if (!instructionId) throw new Error("Could not find id");
  const { t } = useLingui();
  const permissions = usePermissions();
  const [, setSearchParams] = useSearchParams();

  const formFetcher = useFetcher<{ success: boolean }>();
  const usedInFetcher = useFetcher<{ success: boolean }>();
  const ungroupFetcher = useFetcher<{ success: boolean }>();
  const [isDeleting, setIsDeleting] = useState(false);
  const [description, setDescription] = useState<JSONContent>(
    (step.description as JSONContent) ?? {}
  );
  const onUploadImage = useImageUpload(`assembly/${instructionId}`);

  const members = useMemo(
    () => viewerSteps.filter((s) => s.parentStepId === step.id),
    [viewerSteps, step.id]
  );

  // The steps that may use this sub-assembly: later, ordinary, not its own.
  const usingOptions = useMemo(
    () =>
      viewerSteps
        .filter(
          (candidate) =>
            usableSubAssemblies(viewerSteps, candidate.id).find(
              (option) => option.headerId === step.id
            )?.reason === null
        )
        .map((candidate) => ({
          stepId: candidate.id,
          label: `${subPlan.get(candidate.id)?.number ?? ""} · ${titleOf(
            candidate.id
          )}`
        })),
    [viewerSteps, step.id, subPlan, titleOf]
  );

  const savedUsedIn = step.usedInStepId ?? "";
  const usedIn =
    usedInFetcher.state !== "idle" && usedInFetcher.formData
      ? ((usedInFetcher.formData.get("usedInStepId") as string | null) ?? "")
      : savedUsedIn;
  const usedInLabel = usedIn
    ? t`Step ${subPlan.get(usedIn)?.number ?? ""} · ${titleOf(usedIn)}`
    : t`Main build (after its last step)`;

  const onUsedInChange = (next: string) => {
    if (next === usedIn) return;
    const formData = new FormData();
    formData.append("usedInStepId", next);
    usedInFetcher.submit(formData, {
      method: "post",
      action: path.to.assemblySubAssembly(instructionId, step.id)
    });
  };

  const closeIfOpen = () =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (next.get(SUB_ASSEMBLY_PARAM) === step.id) {
          next.delete(SUB_ASSEMBLY_PARAM);
        }
        return next;
      },
      { preventScrollReset: true }
    );

  const cannotSave = isDisabled || !permissions.can("update", "production");
  const hasCamera = step.camera != null;
  const name = step.title || t`Sub-Assembly`;

  return (
    <VStack spacing={4} className="w-full px-4 pb-4 pt-3">
      <ValidatedForm
        validator={assemblyInstructionStepValidator}
        method="post"
        action={path.to.assemblyInstructionStep(instructionId, step.id)}
        defaultValues={{
          id: step.id,
          assemblyInstructionId: instructionId,
          title: step.title ?? ""
        }}
        fetcher={formFetcher}
        className="w-full"
      >
        <Hidden name="id" />
        <Hidden name="assemblyInstructionId" />
        <Hidden name="type" value="Task" />
        <Hidden name="description" value={JSON.stringify(description)} />
        <VStack spacing={4} className="w-full">
          <Input
            name="title"
            label={t`Name`}
            placeholder={t`Sub-Assembly`}
            isReadOnly={isDisabled}
          />
          {!usedIn && (
            <VStack spacing={2} className="w-full">
              <Label>
                <Trans>Instruction</Trans>
              </Label>
              <Editor
                initialValue={(step.description as JSONContent) ?? {}}
                onUpload={onUploadImage}
                onChange={setDescription}
                mentions={[{ char: "@", items: itemMentions }]}
                className="[&_.is-empty]:text-muted-foreground min-h-[88px] max-h-[360px] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent p-3 rounded-lg border w-full"
              />
              <p className="text-xs text-muted-foreground">
                <Trans>
                  How the finished sub-assembly joins the main build.
                </Trans>
              </p>
            </VStack>
          )}
          {!cannotSave && (
            <Submit
              isDisabled={formFetcher.state !== "idle"}
              isLoading={formFetcher.state !== "idle"}
            >
              <Trans>Save</Trans>
            </Submit>
          )}
        </VStack>
      </ValidatedForm>

      <VStack spacing={2} className="w-full">
        <Subheading as="h4" variant="heavy" className="tabular-nums">
          <Trans>Steps</Trans> · {members.length}
        </Subheading>
        {members.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            <Trans>
              No steps yet. Drag steps into it, or use Move Into from a step's
              menu.
            </Trans>
          </p>
        ) : (
          <ul className="w-full divide-y divide-border rounded-lg border border-border">
            {members.map((member) => (
              <li key={member.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  onClick={() => onSelectStep(member.id)}
                >
                  <span className="w-8 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {subPlan.get(member.id)?.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {titleOf(member.id)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </VStack>

      <VStack spacing={2} className="w-full">
        <Subheading as="h4" variant="heavy">
          <Trans>Where it goes</Trans>
        </Subheading>
        <div className="w-full divide-y divide-border rounded-lg border border-border bg-card">
          <PlaybackRow
            label={
              <LabelWithHelp termId="assembly-sub-assembly" variant="inline">
                <span className="whitespace-nowrap">
                  <Trans>Used in</Trans>
                </span>
              </LabelWithHelp>
            }
          >
            {isDisabled ? (
              <span
                className="max-w-[11rem] truncate text-xs text-foreground"
                title={usedInLabel}
              >
                {usedInLabel}
              </span>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-6 max-w-[11rem] items-center gap-1 rounded-md border border-border bg-card px-2 text-xs text-foreground shadow-button-base hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <span className="truncate">{usedInLabel}</span>
                    <LuChevronDown className="size-3 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-[16rem] max-w-[20rem] max-h-72 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
                >
                  <DropdownMenuRadioGroup
                    value={usedIn}
                    onValueChange={onUsedInChange}
                  >
                    <DropdownMenuRadioItem value="">
                      <Trans>Main build (after its last step)</Trans>
                    </DropdownMenuRadioItem>
                    {usingOptions.map((option) => (
                      <DropdownMenuRadioItem
                        key={option.stepId}
                        value={option.stepId}
                        title={option.label}
                      >
                        <span className="truncate">{option.label}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </PlaybackRow>
          {!usedIn && (
            <PlaybackRow
              label={
                <LabelWithHelp termId="assembly-step-camera" variant="inline">
                  <Trans>Camera</Trans>
                </LabelWithHelp>
              }
              value={
                hasCamera ? <Trans>Saved view</Trans> : <Trans>Automatic</Trans>
              }
            >
              {!isDisabled && (
                <HStack spacing={1}>
                  {hasCamera && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onClearCamera(step.id)}
                    >
                      <Trans>Clear</Trans>
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onSetCamera(step.id)}
                  >
                    <Trans>Use Current View</Trans>
                  </Button>
                </HStack>
              )}
            </PlaybackRow>
          )}
        </div>
      </VStack>

      {!isDisabled && (
        <div className="flex w-full flex-wrap gap-2">
          <Button
            variant="secondary"
            leftIcon={<LuUngroup />}
            isLoading={ungroupFetcher.state !== "idle"}
            isDisabled={ungroupFetcher.state !== "idle"}
            onClick={() => {
              closeIfOpen();
              ungroupFetcher.submit(new FormData(), {
                method: "post",
                action: path.to.assemblySubAssemblyUngroup(
                  instructionId,
                  step.id
                )
              });
            }}
          >
            <Trans>Ungroup</Trans>
          </Button>
          <Button
            variant="destructive"
            leftIcon={<LuTrash />}
            isDisabled={!permissions.can("delete", "production")}
            onClick={() => setIsDeleting(true)}
          >
            <Trans>Delete Sub-Assembly</Trans>
          </Button>
        </div>
      )}

      {isDeleting && (
        <ConfirmDelete
          action={path.to.assemblySubAssemblyDelete(instructionId, step.id)}
          name={name}
          text={t`Delete this sub-assembly and all of its steps? This cannot be undone.`}
          onCancel={() => setIsDeleting(false)}
          onSubmit={() => {
            closeIfOpen();
            setIsDeleting(false);
          }}
        />
      )}
    </VStack>
  );
}
