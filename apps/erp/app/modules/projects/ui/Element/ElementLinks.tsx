// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Button,
  Combobox,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuCheck, LuLink, LuPlus, LuTrash } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";
import type { ProjectElementLinkType } from "../../projects.models";
import {
  allowedLinkEnds,
  canLink,
  projectElementLinkTypes
} from "../../projects.models";
import type { ProjectElementPage } from "../../projects.server";
import type { ProjectElementLink } from "../../types";
import {
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import { ElementTypeIcon } from "../Elements/ElementTypeIcon";
import { SuspectBadge } from "../Elements/VerificationStatus";
import { StateIcon } from "../Project/StateIcon";

type ListElement = ProjectElementPage["elements"][number];

/** The forward and reverse label of every link type, translated. */
export function useLinkTypeLabels(): Record<
  ProjectElementLinkType,
  { forward: string; reverse: string }
> {
  const { t } = useLingui();
  return useMemo(
    () => ({
      satisfies: { forward: t`Satisfies`, reverse: t`Satisfied by` },
      verifies: { forward: t`Verifies`, reverse: t`Verified by` },
      derives: { forward: t`Derives`, reverse: t`Derived from` },
      implements: { forward: t`Implements`, reverse: t`Implemented by` },
      blocks: { forward: t`Blocks`, reverse: t`Blocked by` },
      precedes: { forward: t`Precedes`, reverse: t`Follows` },
      "relates to": { forward: t`Relates to`, reverse: t`Relates to` },
      feeds: { forward: t`Feeds`, reverse: t`Fed by` }
    }),
    [t]
  );
}

type Direction = "out" | "in";

/**
 * The trace links of one element, grouped by direction and type ("Verified
 * by", "Satisfies"). A suspect link shows an amber triangle and **Mark
 * reviewed**. A `feeds` link belongs to a formula and is read only.
 */
export function ElementLinks({
  projectId,
  element,
  elements,
  links,
  isDisabled,
  isAdding,
  onAddingChange
}: {
  projectId: string;
  element: { id: string; type: ListElement["type"] };
  elements: ListElement[];
  links: ProjectElementLink[];
  isDisabled: boolean;
  /** The Add link popover's open state, so a menu can open it. */
  isAdding?: boolean;
  onAddingChange?: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const labels = useLinkTypeLabels();
  const changeRequestId = useActiveChangeRequestId();
  const byId = useMemo(
    () => new Map(elements.map((e) => [e.id, e])),
    [elements]
  );
  const fetcher = useAction<{
    success?: boolean;
    error?: { message: string } | null;
  }>({
    onError: (data) =>
      toast.error(data.error?.message ?? t`Failed to change the link`)
  });
  const submit = (intent: "delete" | "clearSuspect", id: string) =>
    fetcher.submit(
      { intent, id },
      {
        method: "post",
        action: withChangeRequest(
          path.to.projectElementLinks(projectId),
          changeRequestId
        )
      }
    );

  const groups = useMemo(() => {
    const result: {
      key: string;
      label: string;
      rows: { link: ProjectElementLink; other: ListElement }[];
    }[] = [];
    const add = (
      direction: Direction,
      link: ProjectElementLink,
      otherId: string
    ) => {
      const other = byId.get(otherId);
      if (!other) return;
      const key = `${direction}:${link.linkType}`;
      let group = result.find((g) => g.key === key);
      if (!group) {
        group = {
          key,
          label:
            direction === "out"
              ? labels[link.linkType].forward
              : labels[link.linkType].reverse,
          rows: []
        };
        result.push(group);
      }
      group.rows.push({ link, other });
    };
    for (const link of links) {
      if (link.fromElementId === element.id) add("out", link, link.toElementId);
      if (link.toElementId === element.id) add("in", link, link.fromElementId);
    }
    const order = (key: string) => {
      const [direction, type] = key.split(":");
      return (
        projectElementLinkTypes.indexOf(type as ProjectElementLinkType) * 2 +
        (direction === "in" ? 1 : 0)
      );
    };
    return result.sort((a, b) => order(a.key) - order(b.key));
  }, [links, element.id, byId, labels]);

  return (
    <div className="flex w-full flex-col gap-3">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{group.label}</span>
          <div className="flex flex-col rounded-lg border border-border">
            {group.rows.map(({ link, other }) => (
              <div
                key={link.id}
                className="flex h-10 items-center gap-2 border-b border-border/60 px-3 text-sm last:border-b-0"
              >
                <ElementTypeIcon type={other.type} />
                <Link
                  to={path.to.projectElement(projectId, other.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
                >
                  <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {other.readableId}
                  </span>
                  <span className="truncate">{other.name}</span>
                </Link>
                {other.state && (
                  <StateIcon
                    group={other.state.group}
                    color={other.state.color}
                  />
                )}
                {link.suspectSince && (
                  <>
                    <SuspectBadge />
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<LuCheck />}
                      isDisabled={isDisabled || fetcher.state !== "idle"}
                      onClick={() => submit("clearSuspect", link.id)}
                    >
                      <Trans>Mark reviewed</Trans>
                    </Button>
                  </>
                )}
                {link.linkType === "feeds" ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground">
                        <LuLink className="size-3.5" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <Trans>The formula writes this link</Trans>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <IconButton
                    aria-label={t`Delete link`}
                    icon={<LuTrash />}
                    variant="ghost"
                    size="sm"
                    isDisabled={isDisabled || fetcher.state !== "idle"}
                    onClick={() => submit("delete", link.id)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      <AddLink
        projectId={projectId}
        element={element}
        elements={elements}
        links={links}
        isDisabled={isDisabled}
        open={isAdding}
        onOpenChange={onAddingChange}
      />
    </div>
  );
}

/**
 * Add link: a link type (this element at either end) and the other element,
 * filtered by `allowedLinkEnds`. The route checks `canLink` again.
 */
function AddLink({
  projectId,
  element,
  elements,
  links,
  isDisabled,
  open: openProp,
  onOpenChange
}: {
  projectId: string;
  element: { id: string; type: ListElement["type"] };
  elements: ListElement[];
  links: ProjectElementLink[];
  isDisabled: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const labels = useLinkTypeLabels();
  const changeRequestId = useActiveChangeRequestId();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [choice, setChoice] = useState("");
  const [otherId, setOtherId] = useState("");
  const fetcher = useAction<{
    success?: boolean;
    error?: { message: string } | null;
  }>({
    onSuccess: () => {
      setOpen(false);
      setChoice("");
      setOtherId("");
    },
    onError: (data) =>
      toast.error(data.error?.message ?? t`Failed to add the link`)
  });

  // A user never adds a feeds link; a symmetric type is offered once.
  const typeOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    for (const type of projectElementLinkTypes) {
      if (type === "feeds") continue;
      const ends = allowedLinkEnds[type];
      if (ends.from.includes(element.type)) {
        options.push({ value: `out:${type}`, label: labels[type].forward });
      }
      if (type !== "relates to" && ends.to.includes(element.type)) {
        options.push({ value: `in:${type}`, label: labels[type].reverse });
      }
    }
    return options;
  }, [element.type, labels]);

  const [direction, type] = choice.split(":") as [
    Direction | "",
    ProjectElementLinkType | undefined
  ];
  const elementOptions = useMemo(() => {
    if (!type) return [];
    return elements
      .filter((other) => {
        if (other.id === element.id) return false;
        const from = direction === "out" ? element : other;
        const to = direction === "out" ? other : element;
        return canLink(from, to, type, links).ok;
      })
      .map((other) => ({
        value: other.id,
        label: `${other.readableId} ${other.name}`,
        keywords: other.readableId
      }));
  }, [elements, element, direction, type, links]);

  const add = () => {
    if (!type || !otherId) return;
    fetcher.submit(
      {
        intent: "upsert",
        linkType: type,
        fromElementId: direction === "out" ? element.id : otherId,
        toElementId: direction === "out" ? otherId : element.id
      },
      {
        method: "post",
        action: withChangeRequest(
          path.to.projectElementLinks(projectId),
          changeRequestId
        )
      }
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<LuPlus />}
          isDisabled={isDisabled || typeOptions.length === 0}
          className="self-start"
        >
          <Trans>Add link</Trans>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-80 flex-col gap-3">
        <Combobox
          asButton
          size="sm"
          value={choice}
          options={typeOptions}
          placeholder={t`Link type`}
          onChange={(next) => {
            setChoice(next);
            setOtherId("");
          }}
        />
        <Combobox
          asButton
          size="sm"
          value={otherId}
          options={elementOptions}
          placeholder={t`Element`}
          disabled={!type}
          emptyMessage={t`No element can take this link`}
          onChange={setOtherId}
        />
        <Button
          isDisabled={!type || !otherId}
          isLoading={fetcher.state !== "idle"}
          onClick={add}
          className="self-end"
        >
          <Trans>Add link</Trans>
        </Button>
      </PopoverContent>
    </Popover>
  );
}
