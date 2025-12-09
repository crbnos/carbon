import type { LinearIssue } from "@carbon/ee/linear";
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
  VStack,
} from "@carbon/react";
import { Link } from "@remix-run/react";
import { useId, useState } from "react";
import { LuExternalLink } from "react-icons/lu";
import z from "zod";
import { LinearIssueStateBadge } from "~/components/Icons";
import { useAsyncFetcher } from "~/hooks/useAsyncFetcher";
import type { IssueActionTask } from "~/modules/quality";
import { path } from "~/utils/path";

type Props = {
  task: IssueActionTask;
  linked?: LinearIssue;
  onClose: () => void;
};

const linkIssueValidator = z.object({
  actionId: z.string(),
  issueId: z.string(),
});

export const LinkIssue = (props: Props) => {
  const id = useId();
  const [issueId, setIssueId] = useState<string | undefined>();

  const { issues, fetcher } = useLinearIssues();

  const onSearch = useDebounce((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value || e.target.value.trim().length < 3) return;

    fetcher.load(
      path.to.api.linearLinkExistingIssue +
        `?actionId=${props.task.id}&search=${e.target.value}`
    );
  }, 300);

  const isSearching = fetcher.state === "loading";

  return (
    <ValidatedForm
      id={id}
      method="post"
      action={path.to.api.linearLinkExistingIssue}
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
            placeholder="Search by linear issue title..."
            onChange={onSearch}
            disabled={isSearching}
          />
          {isSearching && (
            <Spinner className="w-5 h-5 absolute right-3.5  text-primary animate-spin" />
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
                    <Link
                      to={issue.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center"
                    >
                      <span className="mr-2 text-foreground flex items-center">
                        {issue.title}
                        <LuExternalLink className="size-4 ml-2 text-primary" />
                      </span>
                    </Link>

                    <div className="flex items-center gap-2">
                      <Badge
                        variant={"outline"}
                        className="font-normal font-mono text-muted-foreground flex items-center"
                      >
                        {issue.identifier}
                      </Badge>
                      <LinearIssueStateBadge
                        state={issue.state}
                        className="size-3.5"
                      />
                    </div>
                  </div>

                  <div className="mt-2 text-sm text-muted-foreground flex justify-between items-center">
                    <span>
                      {issue.assignee?.email
                        ? `Assigned to ${issue.assignee?.email}`
                        : "Unassigned"}
                    </span>
                  </div>
                </div>
              </div>
            </ToggleGroupItem>
          ))}

          {issues.length === 0 && !isSearching && (
            <p className="text-sm text-muted-foreground">
              No Linear issues found
            </p>
          )}
        </ToggleGroup>
      </VStack>
      <ModalFooter>
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

const useLinearIssues = () => {
  const fetcher = useAsyncFetcher<{
    issues: LinearIssue[];
    linked?: LinearIssue;
  }>();

  return {
    issues: fetcher.data?.issues || [],
    linked: fetcher.data?.linked || null,
    fetcher,
  };
};
