// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  Card,
  CardAction,
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
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuPencil, LuPlus, LuTrash } from "react-icons/lu";
import { Color, Hidden, Input, Submit } from "~/components/Form";
import Confirm from "~/components/Modals/Confirm/Confirm";
import { projectLabelValidator } from "../../projects.models";
import type { ProjectLabel } from "../../types";

type ProjectLabelsProps = {
  labels: ProjectLabel[];
  action: string;
  isDisabled: boolean;
};

type EditingLabel = {
  id?: string;
  name: string;
  color: string;
};

const DEFAULT_LABEL_COLOR = "#2563eb";

const ProjectLabels = ({ labels, action, isDisabled }: ProjectLabelsProps) => {
  const { t } = useLingui();
  const [editing, setEditing] = useState<EditingLabel | null>(null);
  const [deleting, setDeleting] = useState<ProjectLabel | null>(null);
  const deleteDisclosure = useDisclosure();

  return (
    <Card>
      <HStack className="justify-between items-start">
        <CardHeader>
          <CardTitle>
            <Trans>Labels</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Tag elements across the tree, for example by discipline.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardAction>
          <Button
            variant="secondary"
            leftIcon={<LuPlus />}
            isDisabled={isDisabled}
            onClick={() => setEditing({ name: "", color: DEFAULT_LABEL_COLOR })}
          >
            <Trans>Add Label</Trans>
          </Button>
        </CardAction>
      </HStack>
      <CardContent>
        {labels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No labels yet.</Trans>
          </p>
        ) : (
          <div className="flex flex-col rounded-lg border border-border">
            {labels.map((label) => (
              <div
                key={label.id}
                className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                  aria-hidden
                />
                <span className="flex-1 min-w-0 truncate text-sm">
                  {label.name}
                </span>
                <span className="font-mono text-xs uppercase text-muted-foreground shrink-0">
                  {label.color}
                </span>
                <IconButton
                  aria-label={t`Edit ${label.name}`}
                  icon={<LuPencil />}
                  variant="ghost"
                  size="sm"
                  isDisabled={isDisabled}
                  onClick={() =>
                    setEditing({
                      id: label.id,
                      name: label.name,
                      color: label.color
                    })
                  }
                />
                <IconButton
                  aria-label={t`Delete ${label.name}`}
                  icon={<LuTrash />}
                  variant="ghost"
                  size="sm"
                  isDisabled={isDisabled}
                  onClick={() => {
                    setDeleting(label);
                    deleteDisclosure.onOpen();
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {editing && (
        <ProjectLabelModal
          action={action}
          initialValues={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {deleteDisclosure.isOpen && deleting && (
        <Confirm
          action={action}
          title={t`Delete ${deleting.name}`}
          text={t`Delete the label ${deleting.name}? It is removed from every element that has it.`}
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
          <input type="hidden" name="intent" value="deleteLabel" />
          <input type="hidden" name="id" value={deleting.id} />
        </Confirm>
      )}
    </Card>
  );
};

function ProjectLabelModal({
  action,
  initialValues,
  onClose
}: {
  action: string;
  initialValues: EditingLabel;
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
          validator={projectLabelValidator}
          method="post"
          action={action}
          defaultValues={initialValues}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>{isEditing ? t`Edit Label` : t`New Label`}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="upsertLabel" />
            <Hidden name="id" />
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

export default ProjectLabels;
