// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuPencil, LuPlus, LuTrash } from "react-icons/lu";
import { Color, Hidden, Input, Submit } from "~/components/Form";
import Confirm from "~/components/Modals/Confirm/Confirm";
import type { ProjectStateGroup } from "../../projects.models";
import {
  projectStateGroups,
  projectStateValidator
} from "../../projects.models";
import type { ProjectState } from "../../types";
import { StateIcon } from "./StateIcon";

type ProjectStatesProps = {
  states: ProjectState[];
  action: string;
  isDisabled: boolean;
};

type EditingState = {
  id?: string;
  name: string;
  group: ProjectStateGroup;
  color: string;
};

/**
 * The workflow states of a project, in their five groups. A state is
 * renamed and recolored in a modal; the default of each group is the
 * state a new element takes.
 */
const ProjectStates = ({ states, action, isDisabled }: ProjectStatesProps) => {
  const { t } = useLingui();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [deleting, setDeleting] = useState<ProjectState | null>(null);
  const deleteDisclosure = useDisclosure();
  const defaultFetcher = useAction();

  const groupLabels: Record<ProjectStateGroup, string> = {
    Backlog: t`Backlog`,
    Unstarted: t`Unstarted`,
    Started: t`Started`,
    Completed: t`Completed`,
    Cancelled: t`Cancelled`
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>States</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Each element is in one state. The group decides what the state
            means: an element in a Started state takes charges, and a new
            element takes its group's default state.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {projectStateGroups.map((group) => {
          const groupStates = states.filter((state) => state.group === group);
          return (
            <div key={group} className="flex flex-col gap-1">
              <HStack className="justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {groupLabels[group]}
                </span>
                <IconButton
                  aria-label={t`Add a ${groupLabels[group]} state`}
                  icon={<LuPlus />}
                  variant="ghost"
                  size="sm"
                  isDisabled={isDisabled}
                  onClick={() =>
                    setEditing({
                      name: "",
                      group,
                      color: groupStates[0]?.color ?? "#60646C"
                    })
                  }
                />
              </HStack>
              <div className="flex flex-col rounded-lg border border-border">
                {groupStates.map((state) => (
                  <div
                    key={state.id}
                    className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
                  >
                    <StateIcon
                      group={state.group}
                      color={state.color}
                      className="shrink-0"
                    />
                    <span className="flex-1 min-w-0 truncate text-sm">
                      {state.name}
                    </span>
                    <span
                      className="size-4 shrink-0 rounded ring-1 ring-inset ring-black/10"
                      style={{ backgroundColor: state.color }}
                      aria-hidden
                    />
                    <span className="font-mono text-xs uppercase text-muted-foreground shrink-0">
                      {state.color}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex shrink-0 items-center gap-2">
                          {state.isDefault && (
                            <Badge variant="secondary">
                              <Trans>Default</Trans>
                            </Badge>
                          )}
                          <Switch
                            aria-label={t`Default ${groupLabels[group]} state`}
                            checked={state.isDefault}
                            disabled={
                              isDisabled ||
                              state.isDefault ||
                              defaultFetcher.isPending
                            }
                            onCheckedChange={(checked) => {
                              if (!checked) return;
                              defaultFetcher.submit(
                                { intent: "setDefaultState", id: state.id },
                                { method: "post", action }
                              );
                            }}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <Trans>A new element takes the default state</Trans>
                      </TooltipContent>
                    </Tooltip>
                    <IconButton
                      aria-label={t`Edit ${state.name}`}
                      icon={<LuPencil />}
                      variant="ghost"
                      size="sm"
                      isDisabled={isDisabled}
                      onClick={() =>
                        setEditing({
                          id: state.id,
                          name: state.name,
                          group: state.group,
                          color: state.color
                        })
                      }
                    />
                    <IconButton
                      aria-label={t`Delete ${state.name}`}
                      icon={<LuTrash />}
                      variant="ghost"
                      size="sm"
                      isDisabled={isDisabled || groupStates.length <= 1}
                      onClick={() => {
                        setDeleting(state);
                        deleteDisclosure.onOpen();
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>

      {editing && (
        <ProjectStateModal
          action={action}
          initialValues={editing}
          groupLabel={groupLabels[editing.group]}
          onClose={() => setEditing(null)}
        />
      )}

      {deleteDisclosure.isOpen && deleting && (
        <Confirm
          action={action}
          title={t`Delete ${deleting.name}`}
          text={t`Delete the state ${deleting.name}? A state that elements use cannot be deleted.`}
          confirmText={t`Delete`}
          confirmVariant="destructive"
          onCancel={() => {
            deleteDisclosure.onClose();
            setDeleting(null);
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
            setDeleting(null);
          }}
        >
          <input type="hidden" name="intent" value="deleteState" />
          <input type="hidden" name="id" value={deleting.id} />
        </Confirm>
      )}
    </Card>
  );
};

function ProjectStateModal({
  action,
  initialValues,
  groupLabel,
  onClose
}: {
  action: string;
  initialValues: EditingState;
  groupLabel: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction({ onSuccess: onClose });
  const isEditing = initialValues.id !== undefined;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          validator={projectStateValidator}
          method="post"
          action={action}
          defaultValues={initialValues}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              {isEditing ? t`Edit State` : t`New ${groupLabel} State`}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="upsertState" />
            <Hidden name="id" />
            <Hidden name="group" />
            <div className="flex flex-col gap-4">
              <Input name="name" label={t`Name`} autoFocus />
              <Color name="color" label={t`Color`} />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit>
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

export default ProjectStates;
