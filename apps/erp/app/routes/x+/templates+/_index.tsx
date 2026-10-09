// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { DOCUMENT_CATALOG } from "@carbon/documents/template";
import { Badge, Button, cn, ScrollArea, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuChevronRight, LuFileText, LuLibrary } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import { SettingsPageHeading } from "~/components/SettingsPage";
import { useSettingsSubmodules } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

// Phones: the templates list is a section of Settings, so it gets the module's
// section switcher there (desktop shows no sidebar here, unchanged). Only this
// index route: the editor below it is a pushed screen with Back.
function SettingsSections() {
  const { groups } = useSettingsSubmodules();
  return <GroupedContentSidebar groups={groups} />;
}

export const handle: Handle = {
  compactSidebar: SettingsSections
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { view: "settings", role: "employee" });
  return null;
}

const GROUP_ORDER = [
  "Sales",
  "Purchasing",
  "Inventory",
  "Production",
  "Quality",
  "Labels"
];

export default function DocumentTemplatesIndexRoute() {
  const groups = GROUP_ORDER.map((group) => ({
    group,
    docs: DOCUMENT_CATALOG.filter((entry) => entry.group === group)
  })).filter((g) => g.docs.length > 0);

  return (
    <ScrollArea className="h-full w-full">
      <VStack
        spacing={4}
        className="mx-auto h-full max-w-[60rem] gap-6 px-4 py-12 max-md:py-3"
      >
        <div className="flex w-full items-start justify-between gap-4 max-md:flex-col max-md:gap-3">
          <div className="flex flex-col gap-1">
            <SettingsPageHeading>
              <Trans>Document Templates</Trans>
            </SettingsPageHeading>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Customize the layout of your PDF documents — reorder sections,
                hide what you don't need, and add your own blocks.
              </Trans>
            </p>
          </div>
          <Button variant="secondary" leftIcon={<LuLibrary />} asChild>
            <Link to={path.to.documentSections}>
              <Trans>Shared Sections</Trans>
            </Link>
          </Button>
        </div>

        {groups.map(({ group, docs }) => (
          <section key={group} className="flex w-full flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group}
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {docs.map((doc) => (
                <DocumentCard key={doc.type} doc={doc} />
              ))}
            </div>
          </section>
        ))}
      </VStack>
    </ScrollArea>
  );
}

function DocumentCard({ doc }: { doc: (typeof DOCUMENT_CATALOG)[number] }) {
  const inner = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
        <LuFileText className="size-4" />
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-medium">{doc.label}</span>
        {!doc.supported && (
          <span className="text-xs text-muted-foreground">
            <Trans>Coming soon</Trans>
          </span>
        )}
      </span>
      {doc.supported ? (
        <LuChevronRight className="ml-auto size-4 text-muted-foreground" />
      ) : (
        <Badge variant="secondary" className="ml-auto">
          <Trans>Soon</Trans>
        </Badge>
      )}
    </>
  );

  const className = cn(
    "flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors",
    doc.supported
      ? "hover:border-primary hover:bg-accent/30"
      : "cursor-not-allowed opacity-60"
  );

  if (!doc.supported) {
    return (
      <div aria-disabled className={className}>
        {inner}
      </div>
    );
  }

  return (
    <Link to={path.to.documentTemplate(doc.type)} className={className}>
      {inner}
    </Link>
  );
}
