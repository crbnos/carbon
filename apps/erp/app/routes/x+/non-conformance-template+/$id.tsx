import { error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  Heading,
  HStack,
  Input,
  ScrollArea,
  toast,
  VStack,
} from "@carbon/react";
import { generateHTML, Editor } from "@carbon/react/Editor";
import { today, getLocalTimeZone } from "@internationalized/date";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { nanoid } from "nanoid";
import { useState } from "react";
import { usePermissions, useUser } from "~/hooks";
import { getNonConformanceTemplate } from "~/modules/quality";
import type { Handle } from "~/utils/handle";
import { getPrivateUrl, path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Non-Conformance Templates",
  to: path.to.nonConformanceTemplates,
  module: "quality",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "quality",
    role: "employee",
    bypassRls: true,
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [template] = await Promise.all([getNonConformanceTemplate(client, id)]);

  if (template.error) {
    throw redirect(
      path.to.nonConformanceTemplates,
      await flash(request, error(template.error, "Failed to load NCR template"))
    );
  }

  return json({
    template: template.data,
  });
}

export default function NonConformanceTemplateRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const loaderData = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();

  const [nonConformanceTemplateName, setNonConformanceTemplateName] = useState(
    loaderData?.template?.name ?? ""
  );
  const [content, setContent] = useState<JSONContent>(
    (loaderData?.template?.content ?? {}) as JSONContent
  );

  const updateNonConformanceTemplate = async (content: JSONContent) => {
    await carbon
      ?.from("nonConformanceTemplate")
      .update({
        name: nonConformanceTemplateName,
        content: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", id!);
  };

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/quality/${nanoid()}.${fileType}`;

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

  const handleSave = async () => {
    await updateNonConformanceTemplate(content);
    toast.success("Template saved successfully");
    navigate(path.to.nonConformanceTemplates);
  };

  const handleCancel = () => {
    navigate(path.to.nonConformanceTemplates);
  };

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <HStack className="w-full justify-between">
          <VStack spacing={0}>
            <Heading size="h3">
              Edit <span className="hidden md:inline">Non-Conformance</span>{" "}
              Template
            </Heading>
            <p className="text-sm text-muted-foreground">
              Non-conformance templates are used as a starting point for issues.
              Each non-conformance workflow uses a template to create the issue.
              A single template can be used in multiple workflows.
            </p>
          </VStack>
          {/* <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="More options" icon={<LuEllipsisVertical />} variant="secondary" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>
                  <span>Duplicate</span>
                </DropdownMenuItem>
                
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive>
                  <span>Delete</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div> */}
        </HStack>

        <Card className="my-4 p-0">
          <CardContent className="flex flex-col gap-0 p-6">
            <Input
              autoFocus
              value={nonConformanceTemplateName}
              borderless
              onChange={(e) => setNonConformanceTemplateName(e.target.value)}
              className="font-medium text-2xl"
            />
            {permissions.can("update", "quality") ? (
              <Editor
                initialValue={content}
                onUpload={onUploadImage}
                onChange={(value) => {
                  setContent(value);
                }}
                className="[&_.is-empty]:text-muted-foreground"
              />
            ) : (
              <div
                className="prose dark:prose-invert"
                dangerouslySetInnerHTML={{
                  __html: generateHTML(content),
                }}
              />
            )}
          </CardContent>
          <CardFooter className="border-t bg-muted/30 p-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save</Button>
          </CardFooter>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
