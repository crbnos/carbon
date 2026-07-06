import { requirePermissions } from "@carbon/auth/auth.server";
import { DOCUMENT_CATALOG } from "@carbon/documents/template";
import { Badge, Button, cn, Heading, ScrollArea, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuChevronRight, LuFileText, LuLibrary } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link } from "react-router";
import { path } from "~/utils/path";

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
        className="mx-auto h-full max-w-[60rem] gap-6 px-4 py-12"
      >
        <div className="flex w-full items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Heading size="h3">
              <Trans>Document Templates</Trans>
            </Heading>
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
