import type { ActionTaskEntityType } from "@carbon/ee/action-task-entity";
import type { JiraIssueType, JiraProject, JiraUser } from "@carbon/ee/jira";
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
  projectKey: z.string().min(1, "Project is required"),
  issueTypeId: z.string().min(1, "Issue type is required"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional()
});

export const CreateIssue = (props: Props) => {
  const { t } = useLingui();
  const id = useId();
  const [projectKey, setProjectKey] = useState<string | undefined>();

  const { projects, issueTypes, members, fetcher } =
    useJiraProjects(projectKey);

  const projectOptions = useMemo(
    () =>
      projects.map((p) => ({ label: `${p.key} - ${p.name}`, value: p.key })),
    [projects]
  );

  const issueTypeOptions = useMemo(
    () => issueTypes.map((t) => ({ label: t.name, value: t.id })),
    [issueTypes]
  );

  const memberOptions = useMemo(
    () =>
      members.map((m) => ({
        label: m.displayName,
        value: m.accountId
      })),
    [members]
  );

  const isLoading = fetcher.state === "loading";

  return (
    <ValidatedForm
      id={id}
      method="post"
      action={path.to.api.jiraCreateIssue}
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
          isLoading={isLoading}
          label={t`Project`}
          name="projectKey"
          placeholder={t`Select a project`}
          value={projectKey}
          onChange={(e) => setProjectKey(e?.value)}
          options={projectOptions}
        />
        <Select
          isLoading={isLoading}
          label={t`Issue Type`}
          name="issueTypeId"
          placeholder={t`Select an issue type`}
          options={issueTypeOptions}
          isDisabled={!projectKey || issueTypes.length === 0}
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
        />
        <Select
          label={t`Assign To`}
          name="assignee"
          placeholder={t`Select an assignee`}
          isOptional
          options={memberOptions}
          isDisabled={!projectKey || members.length === 0}
        />
      </VStack>
      <ModalFooter className="px-0 pb-0">
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

const useJiraProjects = (projectKey?: string) => {
  const fetcher = useAsyncFetcher<{
    projects: JiraProject[];
    issueTypes: JiraIssueType[];
    members: JiraUser[];
  }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: not necessary
  useEffect(() => {
    fetcher.load(
      path.to.api.jiraCreateIssue +
        (projectKey ? `?projectKey=${projectKey}` : "")
    );
  }, [projectKey]);

  return {
    projects: fetcher.data?.projects || [],
    issueTypes: fetcher.data?.issueTypes || [],
    members: fetcher.data?.members || [],
    fetcher
  };
};
