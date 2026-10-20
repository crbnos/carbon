// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { LinkSyncSchema, type SyncedEntityType } from "@carbon/ee/issue-sync";
import { JiraIssueMappingSchema } from "@carbon/ee/jira";
import { useRevalidator } from "@carbon/query";
import {
  Badge,
  Button,
  cn,
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
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuExternalLink, LuTriangleAlert } from "react-icons/lu";
import { PiLinkBreak } from "react-icons/pi";
import { Link } from "react-router";
import { JiraIcon, JiraIssueStatusBadge } from "~/components/Icons";
import { useAsyncFetcher } from "~/hooks/useAsyncFetcher";
import { path } from "~/utils/path";
import { CreateIssue } from "./CreateIssue";
import { LinkIssue } from "./LinkIssue";

type Props = {
  entityType: SyncedEntityType;
  taskId: string;
  linkedIssue: unknown;
};

export const JiraIssueDialog = ({ entityType, taskId, linkedIssue }: Props) => {
  const { t } = useLingui();
  const [tab, setTab] = useState("link");
  const revalidator = useRevalidator();

  const disclosure = useDisclosure({
    onClose() {
      setTab("link");
      revalidator.revalidate();
    }
  });

  const { data: linked } = JiraIssueMappingSchema.safeParse(linkedIssue);
  // An inbound change a lock refused (the link's sync snapshot)
  const refused =
    LinkSyncSchema.safeParse((linkedIssue as { sync?: unknown } | null)?.sync)
      .data?.refused ?? null;
  const fetcher = useAsyncFetcher();

  const onUnlink = async () => {
    await fetcher.submit(
      { actionId: taskId, entityType },
      { method: "DELETE", action: path.to.api.jiraLinkExistingIssue }
    );
    disclosure.onClose();
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
      {/* asChild: the trigger is the button itself, not a button around it. */}
      <ModalTrigger asChild onClick={() => disclosure.onToggle()}>
        {linked ? (
          <Button
            leftIcon={<JiraIcon className={"size-4"} />}
            variant="ghost"
            size="sm"
            aria-label={t`Update Jira issue`}
          >
            {linked.key}
            {refused && (
              <LuTriangleAlert className="size-3.5 text-destructive" />
            )}
          </Button>
        ) : (
          <Button
            leftIcon={<JiraIcon className={"size-4"} />}
            variant="ghost"
            size="sm"
            aria-label={t`Connect Jira issue`}
          >
            <Trans>Sync</Trans>
          </Button>
        )}
      </ModalTrigger>
      <ModalContent size={"large"}>
        <Tabs
          value={tab}
          onValueChange={setTab}
          defaultValue="link"
          className="flex min-h-0 flex-col"
        >
          <ModalHeader className="mb-1 flex-row justify-between py-3 pr-10">
            <div className="space-y-1">
              <ModalTitle>
                <Trans>Link Jira Issue</Trans>
              </ModalTitle>
              <ModalDescription>
                <Trans>Search for existing or create a new one</Trans>
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
          {/* The forms below own their ModalBody and ModalFooter, so the footer
              runs edge to edge (a ModalFooter inside a ModalBody is inset). */}
          {linked && (
            <ModalBody>
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
                          {linked.summary}
                          <LuExternalLink className="size-4 ml-2 text-primary" />
                        </span>
                      </Link>

                      <div className="flex items-center gap-2">
                        <Badge
                          variant={"outline"}
                          className="font-normal font-mono text-muted-foreground flex items-center"
                        >
                          {linked.key}
                        </Badge>
                        <JiraIssueStatusBadge
                          status={linked.status}
                          className="size-3.5"
                        />
                      </div>
                    </div>

                    <div className="mt-2 text-sm text-muted-foreground flex justify-between items-center">
                      <span>
                        {linked.assignee?.displayName
                          ? `Assigned to ${linked.assignee.displayName}`
                          : "Unassigned"}
                      </span>

                      <Button
                        onClick={onUnlink}
                        isLoading={fetcher.state === "submitting"}
                        leftIcon={<PiLinkBreak />}
                        size="sm"
                        variant={"destructive"}
                      >
                        <Trans>Unlink</Trans>
                      </Button>
                    </div>
                    {refused && (
                      <p className="mt-2 text-sm text-destructive">
                        <Trans>Not applied: {refused.reason}</Trans>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </ModalBody>
          )}

          <TabsContent
            value="link"
            hidden={isAlreadyLinked}
            className={cn(
              "relative mt-0 min-h-0 flex-col",
              isAlreadyLinked ? "hidden" : "flex"
            )}
          >
            <LinkIssue
              entityType={entityType}
              taskId={taskId}
              linkedIssue={linkedIssue}
              onClose={disclosure.onClose}
            />
          </TabsContent>
          <TabsContent
            value="create"
            className="relative mt-0 flex min-h-0 flex-col"
          >
            <CreateIssue
              entityType={entityType}
              taskId={taskId}
              linkedIssue={linkedIssue}
              onClose={disclosure.onClose}
            />
          </TabsContent>
        </Tabs>
      </ModalContent>
    </Modal>
  );
};
