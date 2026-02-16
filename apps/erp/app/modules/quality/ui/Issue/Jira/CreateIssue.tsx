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
import { useEffect, useId, useMemo, useState } from "react";
import z from "zod";
import { useAsyncFetcher } from "~/hooks/useAsyncFetcher";
import type { IssueActionTask } from "~/modules/quality";
import { path } from "~/utils/path";

type Props = {
  task: IssueActionTask;
  onClose: () => void;
};

const createIssueValidator = z.object({
  actionId: z.string(),
  projectKey: z.string().min(1, "Project is required"),
  issueTypeId: z.string().min(1, "Issue type is required"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional()
});

export const CreateIssue = (props: Props) => {
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
      fetcher={fetcher}
      resetAfterSubmit
      onAfterSubmit={() => props.onClose()}
    >
      <VStack spacing={4}>
        <Hidden name="actionId" value={props.task.id} />
        <Select
          isLoading={isLoading}
          label="Project"
          name="projectKey"
          placeholder="Select a project"
          value={projectKey}
          onChange={(e) => setProjectKey(e?.value)}
          options={projectOptions}
        />
        <Select
          isLoading={isLoading}
          label="Issue Type"
          name="issueTypeId"
          placeholder="Select an issue type"
          options={issueTypeOptions}
          isDisabled={!projectKey || issueTypes.length === 0}
        />
        <Input label="Title" name="title" placeholder="Issue title" required />
        <TextArea
          label="Description"
          name="description"
          placeholder="Issue description"
        />
        <Select
          label="Assign To"
          name="assignee"
          placeholder="Select an assignee"
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
          Cancel
        </Button>
        <Submit>Create</Submit>
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
