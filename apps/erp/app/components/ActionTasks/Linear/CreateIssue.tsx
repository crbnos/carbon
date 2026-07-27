import type { ActionTaskEntityType } from "@carbon/ee/action-task-entity";
import type { LinearTeam, LinearUser } from "@carbon/ee/linear";
import {
  Hidden,
  Input,
  Select,
  Submit,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import { Button, ModalFooter, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useId, useMemo, useState } from "react";
import z from "zod";
import { useAsyncFetcher } from "~/hooks/useAsyncFetcher";
import { path } from "~/utils/path";

type Props = {
  entityType: ActionTaskEntityType;
  taskId: string;
  linkedIssue: unknown;
  onClose: () => void;
};

const createIssueValidator = z.object({
  actionId: z.string(),
  entityType: z.string(),
  teamId: z.string(),
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required")
});

export const CreateIssue = (props: Props) => {
  const { t } = useLingui();
  const id = useId();
  const [team, setTeam] = useState<string | undefined>();

  const { teams, members, fetcher } = useLinearTeams(team);

  const teamOptions = useMemo(
    () => teams.map((el) => ({ label: el.name, value: el.id })),
    [teams]
  );
  const membersOptions = useMemo(
    () => members.map((el) => ({ label: el.email, value: el.id })),
    [members]
  );

  const isSearching = fetcher.state === "loading";

  return (
    <ValidatedForm
      id={id}
      method="post"
      action={path.to.api.linearCreateIssue}
      validator={createIssueValidator}
      // @ts-expect-error TS2322 - TODO: fix type
      fetcher={fetcher}
      resetAfterSubmit
      onAfterSubmit={() => props.onClose()}
    >
      <VStack spacing={4}>
        <Hidden name="actionId" value={props.taskId} />
        <Hidden name="entityType" value={props.entityType} />
        <Select
          isLoading={isSearching}
          label={t`Linear Team`}
          name="teamId"
          placeholder={t`Select a team`}
          value={team}
          onChange={(e) => setTeam(e?.value)}
          options={teamOptions}
        />
        <Input
          label={t`Title`}
          name="title"
          placeholder={t`Issue title`}
          required
        />
        <TextArea
          label={t`Description`}
          name="description"
          placeholder={t`Issue description`}
          required
        />
        <Select
          label={t`Assign To`}
          name="assignee"
          placeholder={t`Select a assignee`}
          isOptional
          options={membersOptions}
        />
      </VStack>
      <ModalFooter>
        <Button
          variant="secondary"
          onClick={() => {
            props.onClose();
          }}
        >
          <Trans>Cancel</Trans>
        </Button>
        <Submit>
          <Trans>Create</Trans>
        </Submit>
      </ModalFooter>
    </ValidatedForm>
  );
};

CreateIssue.displayName = "CreateIssue";

const useLinearTeams = (teamId?: string) => {
  const fetcher = useAsyncFetcher<{
    teams: LinearTeam[];
    members: LinearUser[];
  }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    fetcher.load(
      path.to.api.linearCreateIssue + (teamId ? `?teamId=${teamId}` : "")
    );
  }, [teamId]);

  return {
    teams: fetcher.data?.teams || [],
    members: fetcher.data?.members || [],
    fetcher
  };
};
