import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { appendText, getMergeFields } from "@carbon/documents/template";
import type { JSONContent } from "@carbon/react";
import { Input } from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { PanelProvider, usePanels } from "~/components/Layout";
import { usePermissions } from "~/hooks";
import { getTermsVersion } from "~/modules/settings";
import { InsertFieldMenu } from "~/modules/settings/ui/TermsAndConditions/InsertFieldMenu";
import {
  TermsVersionEditorProvider,
  useTermsVersionEditor
} from "~/modules/settings/ui/TermsAndConditions/TermsVersionEditorContext";
import TermsVersionHeader from "~/modules/settings/ui/TermsAndConditions/TermsVersionHeader";
import TermsVersionProperties from "~/modules/settings/ui/TermsAndConditions/TermsVersionProperties";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Terms & Conditions`, to: path.to.termsVersions },
    (data) => data?.termsVersion?.name
  ),
  module: "settings"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const termsVersion = await getTermsVersion(client, id, companyId);
  if (termsVersion.error) {
    throw redirect(
      path.to.termsVersions,
      await flash(
        request,
        error(termsVersion.error, "Failed to load terms version")
      )
    );
  }

  return { termsVersion: termsVersion.data };
}

export default function TermsVersionEditorRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { termsVersion } = useLoaderData<typeof loader>();

  return (
    <PanelProvider key={id}>
      <TermsVersionEditorProvider
        key={id}
        id={id}
        initialName={termsVersion.name ?? ""}
        initialContent={(termsVersion.content ?? {}) as JSONContent}
      >
        <TermsVersionLayout />
      </TermsVersionEditorProvider>
    </PanelProvider>
  );
}

/**
 * Content + properties only. Deliberately NOT `ResizablePanels` — that always
 * renders a left explorer panel and its drag handle, and a terms version has no
 * tree to explore.
 */
function TermsVersionLayout() {
  const { id } = useParams();
  const { isPropertiesCollapsed } = usePanels();

  return (
    <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
      <TermsVersionHeader />
      <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
        <div className="flex-1 min-w-0 bg-card overflow-hidden">
          <TermsVersionEditor />
        </div>
        {!isPropertiesCollapsed && (
          <TermsVersionProperties key={`properties-${id}`} />
        )}
      </div>
    </div>
  );
}

/** Merge fields common to every selected document type. */
function sharedMergeFields(documentTypes: string[]) {
  const [first, ...rest] = documentTypes.map((type) => getMergeFields(type));
  return (first ?? []).filter((field) =>
    rest.every((fields) => fields.some((f) => f.token === field.token))
  );
}

function TermsVersionEditor() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { t } = useLingui();
  const permissions = usePermissions();
  const { termsVersion } = useLoaderData<typeof loader>();
  const { name, setName, content, setContent } = useTermsVersionEditor();

  // Remounts the editor when a merge field is inserted programmatically.
  const [nonce, setNonce] = useState(0);

  // A version can print on several documents, so only fields EVERY selected
  // document resolves are offered — an unknown token would print blank.
  const mergeFields = sharedMergeFields(termsVersion.documentTypes);
  const knownTokens = mergeFields.map((field) => field.token);

  const canUpdate = permissions.can("update", "settings");

  const insertField = (snippet: string) => {
    setContent(appendText(content, snippet));
    setNonce((n) => n + 1);
  };

  return (
    <div className="flex flex-col gap-4 w-full h-full p-6">
      <div className="flex shrink-0 items-center justify-between gap-4">
        <Input
          className="md:text-3xl text-2xl font-semibold leading-none tracking-tight text-foreground"
          value={name}
          borderless
          aria-label={t`Name`}
          onChange={canUpdate ? (e) => setName(e.target.value) : undefined}
        />
        {canUpdate && (
          <InsertFieldMenu fields={mergeFields} onInsert={insertField} />
        )}
      </div>

      {/* The EDITABLE element carries the height, not the wrapper: clicking
          empty space only focuses the editor if `.ProseMirror` itself covers
          it. A percentage min-height can't work — tiptap renders an
          auto-height div between this wrapper and `.ProseMirror` — so the
          height is viewport-relative, sized just under the pane so an empty
          editor doesn't scroll. */}
      <Editor
        key={nonce}
        className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent [&_.ProseMirror]:min-h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset)-130px)]"
        initialValue={content}
        disableFileUpload
        highlightTokens={knownTokens}
        onChange={(value) => {
          if (!canUpdate) return;
          setContent(value);
        }}
      />
    </div>
  );
}
