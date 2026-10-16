// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  DocumentSectionPlacement,
  HeaderOptions
} from "@carbon/documents/template";
import { withBuiltInSections } from "@carbon/documents/template";
import { validator } from "@carbon/form";
import { useAction } from "@carbon/query";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Button,
  Heading,
  IconButton,
  ScrollArea,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuArrowLeft, LuPencil, LuPlus, LuTrash2 } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { z } from "zod";
import { SectionFormModal } from "~/components/DocumentTemplateEditor/SectionFormModal";
import { usePermissions } from "~/hooks";
import { documentSectionValidator } from "~/modules/settings/settings.models";
import { getDocumentSections } from "~/modules/settings/settings.service";
import { path } from "~/utils/path";

const PLACEMENT_LABELS: Record<DocumentSectionPlacement, string> = {
  body: "Body section",
  header: "Page header",
  footer: "Page footer"
};

type Section = {
  id: string;
  name: string;
  placement: DocumentSectionPlacement;
  content: JSONContent;
  /** Header layout config (logo, which fields show). Header sections only. */
  config?: Partial<HeaderOptions>;
  /** System-provided default — editable (forks a copy), not deletable. */
  builtIn?: boolean;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const sections = await getDocumentSections(client, companyId);
  return {
    sections: withBuiltInSections(
      (sections.data ?? []) as Section[]
    ) as Section[]
  };
}

const deleteSectionForm = z.object({ id: z.string().min(1) });

export async function action(args: ActionFunctionArgs) {
  const intent = (await args.request.clone().formData()).get("intent");
  if (intent === "delete") {
    const input = await validator(deleteSectionForm).request(args);
    if ("invalid" in input) return input.invalid;
    const api = await carbon(args.request);
    return api.settings.removeDocumentSection(input.data);
  }
  const input = await validator(documentSectionValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.settings.saveDocumentSection(input.data);
}

export default function SharedSectionsRoute() {
  const { sections } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const canEdit = permissions.can("update", "settings");

  const [editing, setEditing] = useState<Section | null>(null);
  const disclosure = useDisclosure();
  const { t } = useLingui();
  const deleteFetcher = useAction<typeof action>({
    onSuccess: () => toast.success(t`Section deleted`)
  });

  const openNew = () => {
    setEditing(null);
    disclosure.onOpen();
  };
  const openEdit = (section: Section) => {
    setEditing(section);
    disclosure.onOpen();
  };

  return (
    <ScrollArea className="h-full w-full">
      <VStack
        spacing={4}
        className="mx-auto h-full max-w-[60rem] gap-6 px-4 py-12 max-md:py-3"
      >
        <div className="flex w-full items-start justify-between max-md:flex-col max-md:items-stretch max-md:gap-3">
          <div className="flex items-center gap-3">
            <Link
              to={path.to.documentTemplates}
              aria-label="Back to templates"
              className="flex size-8 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground max-md:shrink-0 max-md:hit-area"
            >
              <LuArrowLeft className="size-4" />
            </Link>
            <div className="flex flex-col gap-1">
              <Heading size="h3">Shared Sections</Heading>
              <p className="text-sm text-muted-foreground">
                Reusable rich-text blocks referenced across your documents. Edit
                once — every document updates.
              </p>
            </div>
          </div>
          {canEdit && (
            <Button leftIcon={<LuPlus />} onClick={openNew}>
              New section
            </Button>
          )}
        </div>

        <div className="flex w-full flex-col gap-2">
          {sections.length === 0 && (
            <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              No shared sections yet.
            </div>
          )}
          {sections.map((section) => (
            <div
              key={section.id}
              className="flex items-center gap-3 rounded-lg border bg-card p-3"
            >
              <div className="flex flex-1 flex-col">
                <span className="text-sm font-medium">{section.name}</span>
              </div>
              {section.builtIn && <Badge>System</Badge>}
              <Badge variant="secondary">
                {PLACEMENT_LABELS[section.placement]}
              </Badge>
              {canEdit && (
                <>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label="Edit section"
                    icon={<LuPencil />}
                    onClick={() => openEdit(section)}
                  />
                  {!section.builtIn && (
                    <deleteFetcher.Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={section.id} />
                      <IconButton
                        size="sm"
                        variant="ghost"
                        type="submit"
                        aria-label="Delete section"
                        icon={<LuTrash2 />}
                      />
                    </deleteFetcher.Form>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </VStack>

      {disclosure.isOpen && (
        <SectionFormModal
          key={editing?.id ?? "new"}
          section={editing}
          onClose={disclosure.onClose}
        />
      )}
    </ScrollArea>
  );
}
