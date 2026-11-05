// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuPlus, LuTrash } from "react-icons/lu";
import { Avatar } from "~/components";
import { Employee, Hidden, Submit } from "~/components/Form";
import { projectMemberValidator } from "../../projects.models";

export type ProjectMember = {
  userId: string;
  user: {
    id: string;
    fullName: string | null;
    avatarUrl: string | null;
  } | null;
};

type ProjectMembersProps = {
  projectId: string;
  members: ProjectMember[];
  action: string;
  isDisabled: boolean;
};

/**
 * The employees who may charge time to a project that restricts charging
 * (DCAA timekeeping). Shown on the project's Settings tab while Restrict
 * charging to members is on.
 */
const ProjectMembers = ({
  projectId,
  members,
  action,
  isDisabled
}: ProjectMembersProps) => {
  const { t } = useLingui();
  const [isAdding, setIsAdding] = useState(false);
  const remover = useAction();
  const removingId =
    remover.state !== "idle" ? remover.formData?.get("userId") : null;

  return (
    <section className="flex w-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-medium">
            <Trans>Members</Trans>
          </h2>
          <p className="text-xs text-muted-foreground">
            <Trans>
              Only these employees can charge time to the project in DCAA
              timekeeping.
            </Trans>
          </p>
        </div>
        <Button
          variant="secondary"
          leftIcon={<LuPlus />}
          isDisabled={isDisabled}
          onClick={() => setIsAdding(true)}
        >
          <Trans>Add Member</Trans>
        </Button>
      </div>
      {members.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
          <Trans>No members yet. Nobody can charge time to the project.</Trans>
        </p>
      ) : (
        <div className="flex flex-col rounded-lg border border-border">
          {members.map((member) => {
            const name = member.user?.fullName ?? member.userId;
            return (
              <div
                key={member.userId}
                className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <Avatar
                  size="xs"
                  name={name}
                  path={member.user?.avatarUrl ?? undefined}
                />
                <span className="flex-1 min-w-0 truncate text-sm">{name}</span>
                <IconButton
                  aria-label={t`Remove ${name}`}
                  icon={<LuTrash />}
                  variant="ghost"
                  size="sm"
                  isDisabled={isDisabled || remover.state !== "idle"}
                  isLoading={removingId === member.userId}
                  onClick={() =>
                    remover.submit(
                      {
                        intent: "removeMember",
                        projectId,
                        userId: member.userId
                      },
                      { method: "post", action }
                    )
                  }
                />
              </div>
            );
          })}
        </div>
      )}

      {isAdding && (
        <ProjectMemberModal
          projectId={projectId}
          action={action}
          onClose={() => setIsAdding(false)}
        />
      )}
    </section>
  );
};

function ProjectMemberModal({
  projectId,
  action,
  onClose
}: {
  projectId: string;
  action: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction({ onSuccess: onClose });

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          validator={projectMemberValidator}
          method="post"
          action={action}
          defaultValues={{ projectId, userId: "" }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Add Member</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="addMember" />
            <Hidden name="projectId" />
            <Employee name="userId" label={t`Employee`} />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit>
              <Trans>Add</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

export default ProjectMembers;
