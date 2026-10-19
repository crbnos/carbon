// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  isRichTextEmpty,
  RecordOutlet,
  RichTextView,
  ToggleGroup,
  ToggleGroupItem,
  toast,
  useDebounce,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { Confirm } from "~/components/Modals";
import { useImageUpload, usePermissions } from "~/hooks";
import { getTraining } from "~/modules/resources/resources.service";
import {
  TrainingExplorer,
  TrainingGuide,
  TrainingHeader,
  TrainingProperties
} from "~/modules/resources/ui";
import { getTagsList } from "~/modules/shared/shared.service";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "training-detail");

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Training`, to: path.to.trainings },
    (data) => data?.training?.name
  ),
  module: "resources"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [training, tags] = await Promise.all([
    getTraining(client, id),
    getTagsList(client, companyId, "training")
  ]);

  if (training.error) {
    throw redirect(
      path.to.trainings,
      await flash(request, error(training.error, "Failed to load training"))
    );
  }

  // bypassRls makes `client` the service role, so the URL id is only proven to
  // exist — not to be this company's.
  if (training.data.companyId !== companyId) {
    logger.error("Training is not in the caller's company", {
      companyId,
      trainingId: id
    });
    throw redirect(path.to.trainings);
  }

  return {
    training: training.data,
    tags: tags.data ?? []
  };
}

export default function TrainingRoute() {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  return (
    <PanelProvider key={id}>
      <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
        <TrainingHeader />
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorerLabel={t`Questions`}
              explorer={<TrainingExplorer key={`explorer-${id}`} />}
              content={
                <div className="bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={4} className="p-4">
                    <TrainingContent key={`content-${id}`} />
                    <RecordOutlet />
                  </VStack>
                </div>
              }
              properties={<TrainingProperties key={`properties-${id}`} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}

function TrainingContent() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { t } = useLingui();
  const permissions = usePermissions();
  const loaderData = useLoaderData<typeof loader>();

  const [content, setContent] = useState<JSONContent>(
    (loaderData?.training?.content ?? {}) as JSONContent
  );

  // A quiet POST, not a fetcher: an autosave every pause in typing must not
  // reload every loader on the page.
  const updateTraining = useDebounce(
    async (content: JSONContent) => {
      const formData = new FormData();
      formData.append("ids", id);
      formData.append("field", "content");
      formData.append("value", JSON.stringify(content ?? {}));
      const response = await fetch(path.to.bulkUpdateTraining, {
        method: "post",
        body: formData
      }).catch(() => null);
      const body = (await response?.json().catch(() => null)) as {
        error?: { message: string } | null;
      } | null;
      if (!response?.ok || body?.error) {
        toast.error(body?.error?.message ?? t`Failed to save the content`);
      }
    },
    500,
    true
  );

  const onUploadImage = useImageUpload("training");

  const canEdit =
    permissions.can("update", "people") &&
    permissions.can("update", "resources") &&
    loaderData?.training?.status === "Draft";

  const guidePath = loaderData?.training?.guidePath ?? null;
  // Content is written text or a PDF, never both. A training with a guide is a
  // PDF training; the toggle only remembers "PDF" before the first upload.
  const [pdfChosen, setPdfChosen] = useState(false);
  const [isRemovePdfOpen, setIsRemovePdfOpen] = useState(false);
  const contentType = guidePath || pdfChosen ? "pdf" : "write";

  return (
    <Card>
      <HStack className="w-full justify-between items-start">
        <CardHeader>
          <CardTitle>
            <Trans>Content</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>What employees read before the questions</Trans>
          </CardDescription>
        </CardHeader>
        <CardAction>
          <ToggleGroup
            type="single"
            value={contentType}
            disabled={!canEdit}
            onValueChange={(value) => {
              if (value === "pdf") setPdfChosen(true);
              if (value === "write") {
                if (guidePath) setIsRemovePdfOpen(true);
                else setPdfChosen(false);
              }
            }}
          >
            <ToggleGroupItem size="sm" value="write">
              <Trans>Write</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem size="sm" value="pdf">
              <Trans>Upload PDF</Trans>
            </ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </HStack>
      <CardContent
        className={
          canEdit && contentType === "write" ? "p-0 overflow-hidden" : undefined
        }
      >
        {contentType === "pdf" ? (
          <TrainingGuide
            trainingId={id}
            guidePath={guidePath}
            canEdit={canEdit}
          />
        ) : canEdit ? (
          // Flush toolbar: pad the text, not the panel.
          <Editor
            toolbar
            toolbarClassName="static bg-transparent px-4"
            className="w-full [&_.ProseMirror]:min-h-[240px] [&_.ProseMirror]:px-6 [&_.ProseMirror]:py-4 max-md:[&_.ProseMirror]:px-4"
            initialValue={content}
            onUpload={onUploadImage}
            onChange={(value) => {
              setContent(value);
              updateTraining(value);
            }}
          />
        ) : // RichTextView shows its empty text on phones only, so say it here.
        isRichTextEmpty(content) ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No content</Trans>
          </p>
        ) : (
          <RichTextView
            content={content}
            empty={<Trans>No content</Trans>}
            className="prose dark:prose-invert max-w-none"
          />
        )}
      </CardContent>
      {isRemovePdfOpen && (
        <Confirm
          action={path.to.bulkUpdateTraining}
          title={t`Switch to Written Content`}
          text={t`This removes the PDF. Employees will see the written content instead.`}
          confirmText={t`Remove PDF`}
          confirmVariant="destructive"
          onCancel={() => setIsRemovePdfOpen(false)}
          onSubmit={() => {
            setIsRemovePdfOpen(false);
            setPdfChosen(false);
          }}
        >
          <input type="hidden" name="ids" value={id} />
          <input type="hidden" name="field" value="guidePath" />
          <input type="hidden" name="value" value="" />
        </Confirm>
      )}
    </Card>
  );
}
