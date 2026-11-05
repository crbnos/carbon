// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  generateHTML,
  HStack,
  IconButton,
  type JSONContent,
  Textarea,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuArrowUp, LuTrash } from "react-icons/lu";
import { DateTime, EmployeeAvatar } from "~/components";
import { useUser } from "~/hooks";
import type { ProjectElementPage } from "../../projects.service";
import { useElementRoutes } from "../Elements/ElementRoutes";

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
  const action = useElementRoutes(projectId).comments(elementId);
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
      {comments.map((comment) => (
        // One card per comment: author and time, then the text.
        <div
          key={comment.id}
          className="group/comment w-full rounded-lg border border-border bg-card"
        >
          <div className="flex items-start justify-between gap-2 px-4 pt-3">
            <HStack spacing={2} className="min-w-0 text-sm">
              <EmployeeAvatar
                employeeId={comment.createdBy?.id ?? null}
                size="xs"
                className="font-medium"
              />
              <span className="text-xs text-muted-foreground">
                <DateTime value={comment.createdAt} />
              </span>
            </HStack>
            {comment.createdBy?.id === user.id && (
              <IconButton
                aria-label={t`Delete comment`}
                icon={<LuTrash />}
                variant="ghost"
                size="sm"
                className="-mr-2 -mt-1 shrink-0 opacity-0 group-hover/comment:opacity-100 focus-visible:opacity-100"
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
          <div
            className="prose prose-sm dark:prose-invert max-w-none px-4 pb-3 pt-2"
            dangerouslySetInnerHTML={{
              __html: generateHTML((comment.content ?? {}) as JSONContent)
            }}
          />
        </div>
      ))}

      {/* The composer is a card too: the text, then a round send button. */}
      <div className="w-full rounded-lg border border-border bg-card focus-within:border-ring">
        <Textarea
          aria-label={t`Leave a comment`}
          placeholder={t`Leave a comment...`}
          value={text}
          rows={2}
          className="resize-none border-0 bg-transparent px-4 pt-3 shadow-none focus-visible:ring-0"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="flex justify-end px-3 pb-3">
          <IconButton
            aria-label={t`Comment`}
            icon={<LuArrowUp />}
            variant="secondary"
            size="sm"
            className="rounded-full"
            isDisabled={!text.trim() || fetcher.isPending}
            isLoading={fetcher.isPending}
            onClick={send}
          />
        </div>
      </div>
    </VStack>
  );
}
