import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type {
  DocumentSectionPlacement,
  HeaderOptions
} from "@carbon/documents/template";
import { withBuiltInSections } from "@carbon/documents/template";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Button,
  Heading,
  IconButton,
  ScrollArea,
  useDisclosure,
  VStack
} from "@carbon/react";
import { useState } from "react";
import { LuArrowLeft, LuPencil, LuPlus, LuTrash2 } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, useFetcher, useLoaderData } from "react-router";
import { SectionFormModal } from "~/components/DocumentTemplateEditor/SectionFormModal";
import { usePermissions } from "~/hooks";
import {
  deleteDocumentSection,
  documentSectionValidator,
  getDocumentSections,
  upsertDocumentSection
} from "~/modules/settings";
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

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();

  if (formData.get("intent") === "delete") {
    const id = String(formData.get("id") ?? "");
    const result = await deleteDocumentSection(client, id, companyId);
    if (result.error) {
      return data(
        { success: false },
        await flash(request, error(result.error, "Failed to delete section"))
      );
    }
    return data(
      { success: true },
      await flash(request, success("Section deleted"))
    );
  }

  const validation = await validator(documentSectionValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, name, placement, content, config } = validation.data;
  const result = await upsertDocumentSection(client, {
    id,
    companyId,
    name,
    placement,
    content: content as JSONContent,
    config: config as Record<string, unknown> | undefined,
    ...(id ? { updatedBy: userId } : { createdBy: userId })
  });

  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to save section"))
    );
  }
  return data(
    { success: true },
    await flash(request, success("Section saved"))
  );
}

export default function SharedSectionsRoute() {
  const { sections } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const canEdit = permissions.can("update", "settings");

  const [editing, setEditing] = useState<Section | null>(null);
  const disclosure = useDisclosure();
  const deleteFetcher = useFetcher();

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
        className="mx-auto h-full max-w-[60rem] gap-6 px-4 py-12"
      >
        <div className="flex w-full items-start justify-between">
          <div className="flex items-center gap-3">
            <Link
              to={path.to.documentTemplates}
              aria-label="Back to templates"
              className="flex size-8 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
