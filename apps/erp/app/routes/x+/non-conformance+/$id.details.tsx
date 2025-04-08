import { assertIsPost, error, success, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  Spinner,
  toast,
  useDebounce,
  VStack,
  type JSONContent,
} from "@carbon/react";
import { Editor, generateHTML } from "@carbon/react/Editor";
import { Await, useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { Suspense, useState } from "react";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { NonConformance } from "~/modules/quality";
import {
  nonConformanceValidator,
  upsertNonConformance,
} from "~/modules/quality";
import type { StorageItem } from "~/types";

import { getLocalTimeZone, now } from "@internationalized/date";
import { nanoid } from "nanoid";
import { Documents } from "~/components";
import { setCustomFields } from "~/utils/form";
import { getPrivateUrl, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    bypassRls: true,
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  return json({});
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "quality",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(nonConformanceValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  if (!validation.data.nonConformanceId) {
    throw new Error("Could not find non-conformance id");
  }

  const nonConformanceId = validation.data.nonConformanceId;
  if (!nonConformanceId) {
    throw new Error("Could not find non-conformance id");
  }

  const updateNonConformance = await upsertNonConformance(client, {
    ...validation.data,
    id: id,
    nonConformanceId: nonConformanceId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (updateNonConformance.error) {
    throw redirect(
      path.to.nonConformance(id),
      await flash(
        request,
        error(updateNonConformance.error, "Failed to update non-conformance")
      )
    );
  }

  throw redirect(
    path.to.nonConformance(id),
    await flash(request, success("Updated non-conformance"))
  );
}

export default function NonConformanceDetailsRoute() {
  const {} = useLoaderData<typeof loader>();

  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    nonConformance: NonConformance;
    files: Promise<StorageItem[]>;
  }>(path.to.nonConformance(id));

  if (!routeData) throw new Error("Could not find non-conformance data");
  const permissions = usePermissions();

  return (
    <div className="flex flex-grow overflow-hidden">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          order={1}
          minSize={10}
          defaultSize={20}
          className="bg-card"
        >
          <ScrollArea className="h-[calc(100dvh-99px)]">
            <div className="grid h-full overflow-hidden p-2"></div>
          </ScrollArea>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel order={2} minSize={40} defaultSize={60}>
          <ScrollArea className="h-[calc(100dvh-99px)]">
            <VStack spacing={2} className="p-2">
              <NonConformanceContent
                id={id}
                title={routeData.nonConformance?.name ?? ""}
                subTitle={routeData.nonConformance?.nonConformanceId ?? ""}
                content={routeData.nonConformance?.content as JSONContent}
              />
              {permissions.is("employee") && (
                <>
                  <Suspense
                    fallback={
                      <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
                        <Spinner className="h-10 w-10" />
                      </div>
                    }
                  >
                    <Await resolve={routeData?.files}>
                      {(resolvedFiles) => (
                        <Documents
                          files={resolvedFiles}
                          sourceDocument="Non-Conformance"
                          sourceDocumentId={id}
                          writeBucket="parts"
                          writeBucketPermission="parts"
                        />
                      )}
                    </Await>
                  </Suspense>
                </>
              )}
            </VStack>
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function NonConformanceContent({
  id,
  title,
  subTitle,
  content: initialContent,
}: {
  id: string;
  title: string;
  subTitle: string;
  content: JSONContent;
}) {
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const [content, setContent] = useState(initialContent ?? {});

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  const onUpdateContent = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("job")
        .update({
          content: content,
          updatedAt: now(getLocalTimeZone()).toString(),
          updatedBy: userId,
        })
        .eq("id", id!);
    },
    2500,
    true
  );

  if (!id) return null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{subTitle}</CardDescription>
        </CardHeader>

        <CardContent>
          {permissions.can("update", "sales") ? (
            <Editor
              initialValue={(content ?? {}) as JSONContent}
              onUpload={onUploadImage}
              onChange={(value) => {
                setContent(value);
                onUpdateContent(value);
              }}
            />
          ) : (
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(content as JSONContent),
              }}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
