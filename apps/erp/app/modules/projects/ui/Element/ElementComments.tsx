// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  generateHTML,
  HStack,
  IconButton,
  Textarea,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuSend, LuTrash } from "react-icons/lu";
import { DateTime, EmployeeAvatar } from "~/components";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";
import type { ProjectElementPage } from "../../projects.server";

type Comment = ProjectElementPage["comments"][number];

/** A plain-text comment as the editor's JSON document, one paragraph a line. */
function toDocument(text: string): JSONContent {
  return {
    type: "doc",
    content: text
      .split("\n")
      .map((line) =>
        line
          ? { type: "paragraph", content: [{ type: "text", text: line }] }
          : { type: "paragraph" }
      )
  };
}

export function ElementComments({
  projectId,
  elementId,
  comments
}: {
  projectId: string;
  elementId: string;
  comments: Comment[];
}) {
  const { t } = useLingui();
  const user = useUser();
  const [text, setText] = useState("");
  const action = path.to.projectElementComments(projectId, elementId);
  const fetcher = useAction<{ success?: boolean }>({
    onSuccess: () => setText("")
  });
  const removeFetcher = useAction<{ success?: boolean }>();

  const send = () => {
    if (!text.trim() || fetcher.isPending) return;
    fetcher.submit(
      { intent: "insert", content: JSON.stringify(toDocument(text.trim())) },
      { method: "post", action }
    );
  };

  return (
    <VStack spacing={3} className="w-full">
      {comments.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <Trans>No comments yet</Trans>
        </p>
      ) : (
        <VStack spacing={3} className="w-full">
          {comments.map((comment) => (
            <div key={comment.id} className="group/comment flex w-full gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <HStack spacing={2} className="text-xs text-muted-foreground">
                  <EmployeeAvatar
                    employeeId={comment.createdBy?.id ?? null}
                    size="xxs"
                  />
                  <DateTime value={comment.createdAt} />
                </HStack>
                <div
                  className="prose prose-sm dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{
                    __html: generateHTML((comment.content ?? {}) as JSONContent)
                  }}
                />
              </div>
              {comment.createdBy?.id === user.id && (
                <IconButton
                  aria-label={t`Delete comment`}
                  icon={<LuTrash />}
                  variant="ghost"
                  size="sm"
                  className="shrink-0 opacity-0 group-hover/comment:opacity-100 focus-visible:opacity-100"
                  isDisabled={removeFetcher.isPending}
                  onClick={() =>
                    removeFetcher.submit(
                      { intent: "delete", id: comment.id },
                      { method: "post", action }
                    )
                  }
                />
              )}
            </div>
          ))}
        </VStack>
      )}
      <VStack spacing={2} className="w-full">
        <Textarea
          placeholder={t`Add a comment...`}
          value={text}
          rows={2}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              send();
            }
          }}
        />
        <HStack className="w-full justify-end">
          <Button
            leftIcon={<LuSend />}
            isDisabled={!text.trim() || fetcher.isPending}
            isLoading={fetcher.isPending}
            onClick={send}
          >
            <Trans>Comment</Trans>
          </Button>
        </HStack>
      </VStack>
    </VStack>
  );
}
