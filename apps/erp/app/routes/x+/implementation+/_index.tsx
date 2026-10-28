// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  buildPageCatalogue,
  catalogueByItem,
  checkMemberPage,
  groupHubPeople,
  type HubPagePerson,
  type HubPeopleGroups,
  type HubPersonStatus,
  type MemberPage,
  memberPageValidator,
  starterMemberPage
} from "@carbon/implementation-hub";
import { getImplementationMembers } from "@carbon/implementation-hub/server";
import {
  MemberPageEmpty,
  MemberPageView,
  type PageEditor,
  toFormFields,
  useHub
} from "@carbon/implementation-hub/ui";
import { getLogger } from "@carbon/logger";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandTrigger,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
  toast,
  useDisclosure
} from "@carbon/react";
import { isInternalEmail } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import {
  LuCheck,
  LuDownload,
  LuEye,
  LuEyeOff,
  LuFileUp,
  LuTrash2
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { FileDropzone } from "~/components";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import {
  setImplementationPreview,
  useImplementationPreview
} from "~/hooks/useImplementationPreview";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

const logger = getLogger("erp", "implementation");

// The Implementation Hub is one page per person, defined by Carbon staff in a
// page file. A person sees their own page, or an empty hub until one is loaded.
// Carbon staff see anyone in the company, with or without a page, and load,
// export and remove pages.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId, email } = await requirePermissions(
    request,
    {}
  );
  const isInternal = isInternalEmail(email);

  // Staff see everyone's status. A pending invite is only readable with
  // elevated access (invites have no read policy, so the employees view
  // reports an invited person as Inactive to the signed-in client), so the
  // people are read the way the Employees screen reads them.
  const peopleClient = isInternal
    ? (
        await requirePermissions(request, {
          role: "employee",
          bypassRls: true
        })
      ).client
    : null;

  const [members, employees] = await Promise.all([
    getImplementationMembers(client, companyId),
    peopleClient
      ? peopleClient
          .from("employees")
          .select("id, name, email, status")
          .eq("companyId", companyId)
      : null
  ]);
  if (employees?.error) {
    logger.error("Failed to load the people for the hub staff bar", {
      companyId,
      error: employees.error
    });
  }

  const rows = (members.data ?? []).filter(
    (member) => isInternal || member.userId === userId
  );
  const people: HubPagePerson[] = (employees?.data ?? []).flatMap((person) =>
    person.id
      ? [
          {
            id: person.id,
            name: person.name ?? "",
            email: person.email ?? null,
            status:
              person.status === "Active" || person.status === "Invited"
                ? person.status
                : "Inactive"
          }
        ]
      : []
  );

  return {
    members: rows,
    people,
    isInternal,
    userId
  };
}

export default function GetStartedRoute() {
  const { t } = useLingui();
  const { members, people, isInternal, userId } =
    useLoaderData<typeof loader>();
  const [livePeople] = usePeople();
  const [params, setParams] = useSearchParams();
  // The page file being loaded; null while the load modal is closed.
  const [loadText, setLoadText] = useState<string | null>(null);

  const nameOf = useMemo(() => {
    const names = new Map(livePeople.map((person) => [person.id, person.name]));
    for (const person of people) {
      if (person.name) names.set(person.id, person.name);
    }
    return (id: string) => names.get(id);
  }, [livePeople, people]);

  // Staff pick from everyone in the company, and anyone with a page who has
  // since left it; everyone else sees their own page.
  const groups = useMemo(() => {
    const known = new Set(people.map((person) => person.id));
    const leavers = members
      .filter((member) => !known.has(member.userId))
      .map((member) => ({
        id: member.userId,
        name: nameOf(member.userId) ?? t`Unknown person`,
        email: null,
        status: "Inactive" as const
      }));
    return groupHubPeople(
      [...people, ...leavers],
      members.map((member) => member.userId)
    );
  }, [people, members, nameOf, t]);
  const everyone = useMemo(
    () => [...groups.carbon, ...groups.configured, ...groups.unconfigured],
    [groups]
  );

  const requested = params.get("as");
  const selectedId = isInternal
    ? (everyone.find((person) => person.id === requested)?.id ??
      groups.configured[0]?.id ??
      groups.carbon.find((person) => person.hasPage)?.id ??
      null)
    : userId;
  const selected = everyone.find((person) => person.id === selectedId);
  const member = members.find((m) => m.userId === selectedId);
  const parsed = member ? memberPageValidator.safeParse(member.page) : null;
  const page = parsed?.success ? parsed.data : null;

  // Staff edit the page in place. Each edit saves the whole page on a fetcher
  // of its own, so a tick on the hub's shared fetcher never cancels it, and a
  // newer save carries every earlier edit. Until a save settles the page shows
  // the edits; then it shows what the server kept.
  const pageFetcher = useFetcher<{ success: boolean; message?: string }>();
  const [draft, setDraft] = useState<{
    memberId: string;
    page: MemberPage;
  } | null>(null);
  const shownPage =
    pageFetcher.state !== "idle" && draft && draft.memberId === selectedId
      ? draft.page
      : page;
  const pageResult = pageFetcher.data;
  useEffect(() => {
    if (pageResult && !pageResult.success && pageResult.message) {
      toast.error(pageResult.message);
    }
  }, [pageResult]);
  const submitPage = pageFetcher.submit;
  const editor = useMemo<PageEditor | undefined>(() => {
    if (!isInternal || !selectedId) return undefined;
    const submit = (fields: Record<string, string>) =>
      submitPage(fields, {
        method: "post",
        action: path.to.implementationState
      });
    return {
      save: (next) => {
        setDraft({ memberId: selectedId, page: next });
        submit(
          toFormFields({ intent: "setMemberPage", page: JSON.stringify(next) })
        );
      },
      addItem: (collection, payload, next, target) => {
        setDraft({ memberId: selectedId, page: next });
        submit(
          toFormFields({
            intent: "addRow",
            collection,
            payload,
            place: { page: next, target }
          })
        );
      }
    };
  }, [isInternal, selectedId, submitPage]);

  const select = (id: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("as", id);
        return next;
      },
      { replace: true }
    );

  return (
    <div className="relative z-10 h-full overflow-y-auto">
      <div className="flex flex-col gap-8 p-4 sm:p-8">
        {isInternal ? (
          <StaffBar
            groups={groups}
            selectedId={selectedId}
            hasPage={member !== undefined}
            page={member?.page}
            onSelect={select}
            onLoad={() => setLoadText("")}
          />
        ) : null}
        {shownPage && selectedId ? (
          <MemberPageView
            page={shownPage}
            memberId={selectedId}
            memberName={nameOf(selectedId)}
            editor={editor}
          />
        ) : member && isInternal ? (
          <p className="w-full max-w-xl mx-auto py-24 text-center text-sm text-muted-foreground">
            <Trans>
              This page no longer matches the page format. Export it, fix it and
              load it again.
            </Trans>
          </p>
        ) : isInternal && selected ? (
          <NoPage
            name={selected.name}
            status={selected.status}
            onSetUp={
              selected.email
                ? () =>
                    setLoadText(
                      JSON.stringify(
                        starterMemberPage(
                          selected.email ?? "",
                          t`Before go-live`
                        ),
                        null,
                        2
                      )
                    )
                : undefined
            }
          />
        ) : isInternal ? (
          <p className="w-full max-w-xl mx-auto py-24 text-center text-sm text-muted-foreground">
            <Trans>
              Choose a person to see their hub page, or to set one up.
            </Trans>
          </p>
        ) : (
          <MemberPageEmpty />
        )}
        {loadText !== null ? (
          <LoadPageModal
            initialText={loadText}
            onClose={() => setLoadText(null)}
            onLoaded={(memberId) => {
              setLoadText(null);
              select(memberId);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

// Carbon staff only: a person without a page, what they see, and the way to
// give them one. Anyone in the company can be given a page: an invited
// person's waits for their first sign-in, an inactive person's for an invite.
function NoPage({
  name,
  status,
  onSetUp
}: {
  name: string;
  status: HubPersonStatus;
  onSetUp?: () => void;
}) {
  return (
    <div className="w-full max-w-xl mx-auto py-24 flex flex-col items-center gap-3 text-center">
      <h2 className="text-base font-semibold">
        <Trans>{name} has no hub page yet</Trans>
      </h2>
      <p className="text-sm text-muted-foreground text-pretty">
        {status === "Invited" ? (
          <Trans>
            They have not accepted their invite yet. A page loaded now is
            waiting for them when they first sign in.
          </Trans>
        ) : status === "Inactive" ? (
          <Trans>
            They are inactive in this company. A page loaded now is waiting for
            them if they are invited again.
          </Trans>
        ) : (
          <Trans>
            Until one is loaded, they see an empty hub that asks them to contact
            their Carbon admin.
          </Trans>
        )}
      </p>
      {onSetUp ? (
        <Button leftIcon={<LuFileUp />} onClick={onSetUp}>
          <Trans>Set up page</Trans>
        </Button>
      ) : null}
    </div>
  );
}

// Carbon staff only: whose hub to see, in three groups. Choosing someone
// without a page shows the way to set one up.
function PersonPicker({
  groups,
  selectedId,
  onSelect
}: {
  groups: HubPeopleGroups;
  selectedId: string | null;
  onSelect: (userId: string) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const sections: {
    key: string;
    heading: string;
    people: (HubPagePerson & { hasPage?: boolean })[];
  }[] = [
    { key: "carbon", heading: t`Carbon users`, people: groups.carbon },
    {
      key: "configured",
      heading: t`Configured users`,
      people: groups.configured
    },
    {
      key: "unconfigured",
      heading: t`Unconfigured users`,
      people: groups.unconfigured
    }
  ];
  const selected = sections
    .flatMap((section) => section.people)
    .find((person) => person.id === selectedId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <CommandTrigger
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={t`Viewing as`}
          className="w-56"
        >
          {selected ? (
            // A div, not a span: the trigger clamps its span children to one
            // line, which would undo this flex row and its gap.
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left">
              <span
                className={cn(
                  "min-w-0 truncate",
                  selected.status === "Inactive" && "text-muted-foreground"
                )}
              >
                {selected.name}
              </span>
              <PersonStatus status={selected.status} />
            </div>
          ) : (
            <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
              <Trans>Choose a person</Trans>
            </span>
          )}
        </CommandTrigger>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder={t`Search people`} />
          <CommandList>
            <CommandEmpty>
              <Trans>No one found.</Trans>
            </CommandEmpty>
            {sections.map((section) =>
              section.people.length ? (
                <CommandGroup key={section.key} heading={section.heading}>
                  {section.people.map((person) => (
                    <CommandItem
                      key={person.id}
                      value={`${person.name} ${person.email ?? ""} ${person.id}`}
                      onSelect={() => {
                        onSelect(person.id);
                        setOpen(false);
                      }}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-baseline gap-1.5">
                          <span
                            className={cn(
                              "truncate",
                              person.status === "Inactive" &&
                                "text-muted-foreground"
                            )}
                          >
                            {person.name}
                          </span>
                          <PersonStatus status={person.status} />
                        </span>
                        {person.email ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {person.email}
                          </span>
                        ) : null}
                      </span>
                      {person.hasPage ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          <Trans>Configured</Trans>
                        </span>
                      ) : null}
                      <LuCheck
                        className={cn(
                          "ml-2 size-4 shrink-0",
                          person.id === selectedId ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// A quiet marker beside a name for anyone not active: invited and waiting, or
// inactive (deactivated, or their invite was revoked). Active people get none.
function PersonStatus({ status }: { status: HubPersonStatus }) {
  if (status === "Active") return null;
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      {status === "Invited" ? <Trans>Invited</Trans> : <Trans>Inactive</Trans>}
    </span>
  );
}

// Carbon staff only: whose page this is, and the page file actions.
function StaffBar({
  groups,
  selectedId,
  hasPage,
  page,
  onSelect,
  onLoad
}: {
  groups: HubPeopleGroups;
  selectedId: string | null;
  hasPage: boolean;
  page: unknown;
  onSelect: (userId: string) => void;
  onLoad: () => void;
}) {
  const { t, i18n } = useLingui();
  const removeDisclosure = useDisclosure();
  // The confirmation closes itself only once its delete settles, but it is
  // gone by then (the page is), so it would open again with the next page
  // loaded for this person. Close it when the page goes or the person changes.
  const closeRemove = removeDisclosure.onClose;
  useEffect(() => {
    if (!hasPage) closeRemove();
  }, [hasPage, closeRemove]);
  useEffect(() => {
    if (selectedId) closeRemove();
  }, [selectedId, closeRemove]);
  const rows = useHub((s) => s.rows);
  const previewing = useImplementationPreview();
  const selectedName =
    [...groups.carbon, ...groups.configured, ...groups.unconfigured].find(
      (person) => person.id === selectedId
    )?.name ?? t`this person`;

  const label = (value: unknown) =>
    value === undefined
      ? undefined
      : typeof value === "string"
        ? value
        : i18n._(value as Parameters<typeof i18n._>[0]);

  const exportPage = () => {
    if (!page) return;
    const user =
      typeof page === "object" && page && "user" in page
        ? String((page as { user: unknown }).user)
        : "page";
    download(`${user.split("@")[0]}-hub-page.json`, page);
  };

  // Every hub item a page can place, with its key. Template text is in the
  // viewer's language; the keys are what a page file uses.
  const exportCatalogue = () =>
    download(
      "hub-page-catalogue.json",
      buildPageCatalogue(rows).map((entry) => ({
        item: entry.item,
        kind: entry.kind,
        title: label(entry.title),
        group: label(entry.group),
        detail: label(entry.detail)
      }))
    );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">
        <Trans>Carbon staff · Viewing as</Trans>
      </span>
      <PersonPicker
        groups={groups}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={previewing ? "primary" : "secondary"}
          leftIcon={previewing ? <LuEyeOff /> : <LuEye />}
          onClick={() => setImplementationPreview(!previewing)}
        >
          {previewing ? (
            <Trans>Exit preview</Trans>
          ) : (
            <Trans>Preview as customer</Trans>
          )}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<LuFileUp />}
          onClick={onLoad}
        >
          <Trans>Load page file</Trans>
        </Button>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<LuDownload />}
          isDisabled={!page}
          onClick={exportPage}
        >
          <Trans>Export page</Trans>
        </Button>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<LuDownload />}
          onClick={exportCatalogue}
        >
          <Trans>Catalogue</Trans>
        </Button>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<LuTrash2 />}
          isDisabled={!hasPage}
          onClick={removeDisclosure.onOpen}
        >
          <Trans>Remove page</Trans>
        </Button>
      </div>
      {removeDisclosure.isOpen && selectedId && hasPage ? (
        <ConfirmDelete
          action={path.to.implementationState}
          name={selectedName}
          title={t`Remove ${selectedName}'s page`}
          text={t`They will see an empty hub until a new page is loaded. Ticks on hub items stay; ticks on custom cards come back if the same page is loaded again.`}
          deleteText={t`Remove`}
          fields={{ intent: "deleteMemberPage", userId: selectedId }}
          onCancel={removeDisclosure.onClose}
          onSubmit={removeDisclosure.onClose}
        />
      ) : null}
    </div>
  );
}

// Paste or choose a page file, or edit the starter page for someone without
// one. It is checked here first, so most problems show before anything is
// sent; the server checks it again, with the person.
function LoadPageModal({
  initialText,
  onClose,
  onLoaded
}: {
  initialText: string;
  onClose: () => void;
  onLoaded: (memberId: string) => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{
    success: boolean;
    message?: string;
    memberId?: string;
  }>();
  const rows = useHub((s) => s.rows);
  const items = useMemo(
    () => catalogueByItem(buildPageCatalogue(rows)),
    [rows]
  );
  const [text, setText] = useState(initialText);
  const [problems, setProblems] = useState<string[]>([]);

  const result = fetcher.state === "idle" ? fetcher.data : undefined;
  useEffect(() => {
    if (result?.success && result.memberId) onLoaded(result.memberId);
  }, [result, onLoaded]);
  const serverProblems =
    result && !result.success && result.message
      ? result.message.split("\n")
      : [];
  const shown = problems.length ? problems : serverProblems;

  const submit = () => {
    const checked = checkMemberPage(text, items);
    setProblems(checked.problems);
    if (!checked.page) return;
    fetcher.submit(
      toFormFields({
        intent: "setMemberPage",
        page: JSON.stringify(checked.page)
      }),
      { method: "post", action: path.to.implementationState }
    );
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="large">
        <ModalHeader>
          <ModalTitle>
            <Trans>Load a page file</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              One person's page as JSON. It replaces any page they already have.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-3">
            <FileDropzone
              accept={JSON_FILE}
              multiple={false}
              className="p-4"
              onDrop={async ([file]) => {
                if (!file) return;
                setText(await file.text());
                setProblems([]);
              }}
            />
            <Textarea
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setProblems([]);
              }}
              rows={16}
              className="font-mono text-xs"
              placeholder={t`Paste the page file here`}
              aria-label={t`Page file contents`}
            />
            {shown.length ? (
              <ul className="flex flex-col gap-1 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {shown.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            isDisabled={!text.trim() || fetcher.state !== "idle"}
            isLoading={fetcher.state !== "idle"}
            onClick={submit}
          >
            <Trans>Load</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// Page files are JSON.
const JSON_FILE = { "application/json": [".json"] };

function download(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
