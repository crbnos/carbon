import type { JiraIssueMapping } from "@carbon/ee/jira";
import { Hidden, Submit, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  cn,
  Input,
  ModalFooter,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
  useDebounce,
  VStack
} from "@carbon/react";
import { useId, useState } from "react";
import z from "zod";
import { JiraIssueStatusBadge } from "~/components/Icons";
import { useAsyncFetcher } from "~/hooks/useAsyncFetcher";
import type { IssueActionTask } from "~/modules/quality";
import { path } from "~/utils/path";

type Props = {
  task: IssueActionTask;
  linked?: JiraIssueMapping | null;
  onClose: () => void;
};

const linkIssueValidator = z.object({
  actionId: z.string(),
  issueId: z.string()
});

// Jira issue shape from search API
interface JiraSearchIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: {
      name: string;
      statusCategory: {
        key: "new" | "indeterminate" | "done";
      };
    };
    assignee: {
      displayName: string;
      emailAddress?: string;
    } | null;
  };
}

export const LinkIssue = (props: Props) => {
  const id = useId();
  const [issueId, setIssueId] = useState<string | undefined>();

  const { issues, fetcher } = useJiraIssues();

  const onSearch = useDebounce((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value || e.target.value.trim().length < 3) return;

    fetcher.load(
      path.to.api.jiraLinkExistingIssue +
        `?actionId=${props.task.id}&search=${e.target.value}`
    );
  }, 300);

  const isSearching = fetcher.state === "loading";

  return (
    <ValidatedForm
      id={id}
      method="post"
      action={path.to.api.jiraLinkExistingIssue}
      validator={linkIssueValidator}
      fetcher={fetcher}
      resetAfterSubmit
      onAfterSubmit={() => props.onClose()}
    >
      <Hidden name="actionId" value={props.task.id} />
      <Hidden name="issueId" value={issueId} />
      <VStack spacing={4}>
        <div className="w-full flex items-center gap-x-2 relative">
          <Input
            name="query"
            type="search"
            className="w-full"
            autoComplete="off"
            placeholder="Search by Jira issue title..."
            onChange={onSearch}
            disabled={isSearching}
          />
          {isSearching && (
            <Spinner className="w-5 h-5 absolute right-3.5 text-primary animate-spin" />
          )}
        </div>
        <ToggleGroup
          orientation="vertical"
          onValueChange={setIssueId}
          value={issueId}
          type="single"
          className="w-full flex-col gap-y-2"
        >
          {issues.map((issue) => (
            <ToggleGroupItem
              key={issue.id}
              name="issueId"
              value={issue.id}
              disabled={issue.id === props.linked?.id}
              variant={"outline"}
              className={cn(
                "w-full rounded-lg p-3 text-left transition-colors hover:bg-transparent block h-auto data-[state=on]:bg-transparent hover:data-[state=on]:bg-transparent data-[state=on]:border-primary hover:data-[state=on]:border-primary"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 justify-between">
                    <span className="mr-2 text-foreground flex items-center">
                      {issue.fields.summary}
                    </span>

                    <div className="flex items-center gap-2">
                      <Badge
                        variant={"outline"}
                        className="font-normal font-mono text-muted-foreground flex items-center"
                      >
                        {issue.key}
                      </Badge>
                      <JiraIssueStatusBadge
                        status={{
                          name: issue.fields.status.name,
                          category: issue.fields.status.statusCategory.key
                        }}
                        className="size-3.5"
                      />
                    </div>
                  </div>

                  <div className="mt-2 text-sm text-muted-foreground flex justify-between items-center">
                    <span>
                      {issue.fields.assignee?.displayName
                        ? `Assigned to ${issue.fields.assignee.displayName}`
                        : "Unassigned"}
                    </span>
                  </div>
                </div>
              </div>
            </ToggleGroupItem>
          ))}

          {issues.length === 0 && !isSearching && (
            <p className="text-sm text-muted-foreground">
              No Jira issues found
            </p>
          )}
        </ToggleGroup>
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
        <Submit>Save</Submit>
      </ModalFooter>
    </ValidatedForm>
  );
};

LinkIssue.displayName = "LinkIssue";

const useJiraIssues = () => {
  const fetcher = useAsyncFetcher<{
    issues: JiraSearchIssue[];
  }>();

  return {
    issues: fetcher.data?.issues || [],
    fetcher
  };
};
