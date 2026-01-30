import { LinearIssueSchema } from "@carbon/ee/linear";
import {
  Badge,
  Button,
  cn,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useDisclosure
} from "@carbon/react";
import { useState } from "react";
import { LuExternalLink } from "react-icons/lu";
import { PiLinkBreak } from "react-icons/pi";
import { Link, useRevalidator } from "react-router";
import { LinearIcon, LinearIssueStateBadge } from "~/components/Icons";
import { useAsyncFetcher } from "~/hooks/useAsyncFetcher";
import type { IssueActionTask } from "~/modules/quality/types";
import { path } from "~/utils/path";
import { CreateIssue } from "./CreateIssue";
import { LinkIssue } from "./LinkIssue";

interface Props {
  task: IssueActionTask;
}

export const LinearIssueDialog = ({ task }: Props) => {
  const [tab, setTab] = useState("link");
  const revalidator = useRevalidator();

  const disclosure = useDisclosure({
    onClose() {
      revalidator.revalidate();
    }
  });

  const { data: linked } = LinearIssueSchema.safeParse(task.linearIssue);
  const fetcher = useAsyncFetcher();

  const onUnlink = async () => {
    await fetcher.submit(
      { actionId: task.id },
      { method: "DELETE", action: path.to.api.linearLinkExistingIssue }
    );
    revalidator.revalidate();
  };

  const isAlreadyLinked = !!linked?.id;

  return (
    <Modal
      open={disclosure.isOpen}
      onOpenChange={(open) => {
        if (!open) {
          disclosure.onClose();
        }
      }}
    >
      <ModalTrigger onClick={() => disclosure.onToggle()}>
        {linked ? (
          <Button
            leftIcon={<LinearIcon className={"size-4"} />}
            variant="ghost"
            aria-label="Update Linear issue"
          >
            {linked.identifier}
          </Button>
        ) : (
          <IconButton
            icon={<LinearIcon className={"size-4 grayscale"} />}
            variant="ghost"
            aria-label="Connect Linear issue"
          />
        )}
      </ModalTrigger>
      <ModalContent size={"large"}>
        <Tabs value={tab} onValueChange={setTab} defaultValue="link">
          <ModalHeader className="mb-1 flex-row justify-between py-3">
            <div className="space-y-1">
              <ModalTitle>Link Linear Issue</ModalTitle>
              <ModalDescription>
                Search for existing or create a new one
              </ModalDescription>
            </div>

            <TabsList className="max-w-max mb-4">
              <TabsTrigger value="link" disabled={isAlreadyLinked}>
                Link Existing
              </TabsTrigger>
              <TabsTrigger value="create" disabled={isAlreadyLinked}>
                Create New
              </TabsTrigger>
            </TabsList>
          </ModalHeader>
          <ModalBody>
            {linked && (
              <div
                className={cn(
                  "w-full rounded-lg p-3 mb-3 text-left transition-colors block h-auto border border-secondary"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 justify-between">
                      <Link
                        to={linked.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center"
                      >
                        <span className="mr-2 text-foreground flex items-center">
                          {linked.title}
                          <LuExternalLink className="size-4 ml-2 text-primary" />
                        </span>
                      </Link>

                      <div className="flex items-center gap-2">
                        <Badge
                          variant={"outline"}
                          className="font-normal font-mono text-muted-foreground flex items-center"
                        >
                          {linked.identifier}
                        </Badge>
                        <LinearIssueStateBadge
                          state={linked.state}
                          className="size-3.5"
                        />
                      </div>
                    </div>

                    <div className="mt-2 text-sm text-muted-foreground flex justify-between items-center">
                      <span>
                        {linked.assignee?.email
                          ? `Assigned to ${linked.assignee?.email}`
                          : "Unassigned"}
                      </span>

                      <Button
                        onClick={onUnlink}
                        isLoading={fetcher.state === "submitting"}
                        leftIcon={<PiLinkBreak />}
                        size="sm"
                        variant={"destructive"}
                      >
                        Unlink
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <TabsContent
              value="link"
              hidden={isAlreadyLinked}
              className="relative mt-0"
            >
              <LinkIssue
                task={task}
                onClose={disclosure.onClose}
                linked={linked}
              />
            </TabsContent>
            <TabsContent value="create" className="relative mt-0">
              <CreateIssue task={task} onClose={disclosure.onClose} />
            </TabsContent>
          </ModalBody>
        </Tabs>
      </ModalContent>
    </Modal>
  );
};
