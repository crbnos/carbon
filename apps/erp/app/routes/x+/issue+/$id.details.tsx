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
import { issueValidator, upsertIssue } from "~/modules/quality";
import type { StorageItem } from "~/types";

import { nanoid } from "nanoid";
import { Documents } from "~/components";
import { setCustomFields } from "~/utils/form";
import { getPrivateUrl, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "quality",
    bypassRls: true,
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const nonConformance = await client
    .from("nonConformance")
    .select("*")
    .eq("id", id)
    .single();

  if (nonConformance.error) {
    throw new Error(nonConformance.error.message);
  }

  return json({ nonConformance: nonConformance.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "quality",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(issueValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  if (!validation.data.nonConformanceId) {
    throw new Error("Could not find issue id");
  }

  const nonConformanceId = validation.data.nonConformanceId;
  if (!nonConformanceId) {
    throw new Error("Could not find issue id");
  }

  const updateIssue = await upsertIssue(client, {
    ...validation.data,
    id: id,
    nonConformanceId: nonConformanceId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (updateIssue.error) {
    throw redirect(
      path.to.issue(id),
      await flash(request, error(updateIssue.error, "Failed to update issue"))
    );
  }

  throw redirect(
    path.to.issue(id),
    await flash(request, success("Updated issue"))
  );
}

export default function IssueDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { nonConformance } = useLoaderData<typeof loader>();

  const routeData = useRouteData<{
    files: Promise<StorageItem[]>;
  }>(path.to.issue(id));

  if (!routeData) throw new Error("Could not find issue data");
  const permissions = usePermissions();

  return (
    <VStack spacing={2}>
      <IssueContent
        id={id}
        title={nonConformance?.name ?? ""}
        subTitle={nonConformance?.nonConformanceId ?? ""}
        content={nonConformance?.content as JSONContent}
        isDisabled={nonConformance?.status === "Closed"}
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
                  sourceDocument="Issue"
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
  );
}

function IssueContent({
  id,
  title,
  subTitle,
  content: initialContent,
  isDisabled,
}: {
  id: string;
  title: string;
  subTitle: string;
  content: JSONContent;
  isDisabled: boolean;
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
        ?.from("nonConformance")
        .update({
          content: content,
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
          {permissions.can("update", "quality") && !isDisabled ? (
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
