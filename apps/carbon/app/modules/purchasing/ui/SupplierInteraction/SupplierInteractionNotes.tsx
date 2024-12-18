import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useDebounce,
} from "@carbon/react";
import { Editor, generateHTML } from "@carbon/react/Editor";
import { getLocalTimeZone, today } from "@internationalized/date";
import { nanoid } from "nanoid";
import { useState } from "react";
import { usePermissions, useUser } from "~/hooks";
import { getPrivateUrl } from "~/utils/path";

const SupplierInteractionNotes = ({
  id,
  table,
  title,
  internalNotes: initialInternalNotes,
  externalNotes: initialExternalNotes,
}: {
  id: string | null;
  table: "supplierQuote" | "purchaseOrder" | "receipt" | "purchaseInvoice";
  title: string;
  internalNotes?: JSONContent;
  externalNotes?: JSONContent;
}) => {
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();
  const [tab, setTab] = useState("internal");
  const [internalNotes, setInternalNotes] = useState(
    initialInternalNotes ?? {}
  );
  const [externalNotes, setExternalNotes] = useState(
    initialExternalNotes ?? {}
  );

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/supplier-interaction/${id}/${nanoid()}.${fileType}`;

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

  const onUpdateExternalNotes = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from(table)
        .update({
          externalNotes: content,
          updatedAt: today(getLocalTimeZone()).toString(),
          updatedBy: userId,
        })
        .eq("id", id!);
    },
    2500,
    true
  );

  const onUpdateInternalNotes = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from(table)
        .update({
          internalNotes: content,
          updatedAt: today(getLocalTimeZone()).toString(),
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
        <Tabs value={tab} onValueChange={setTab}>
          <HStack className="w-full justify-between">
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardDescription>
                {tab === "internal" ? "Internal Notes" : "External Notes"}
              </CardDescription>
            </CardHeader>
            <CardAction>
              {["purchaseOrder"].includes(table) && (
                <TabsList>
                  <TabsTrigger value="internal">Internal</TabsTrigger>
                  <TabsTrigger value="external">External</TabsTrigger>
                </TabsList>
              )}
            </CardAction>
          </HStack>
          <CardContent>
            <TabsContent value="internal">
              {permissions.can("update", "sales") ? (
                <Editor
                  initialValue={(internalNotes ?? {}) as JSONContent}
                  onUpload={onUploadImage}
                  onChange={(value) => {
                    setInternalNotes(value);
                    onUpdateInternalNotes(value);
                  }}
                />
              ) : (
                <div
                  className="prose dark:prose-invert"
                  dangerouslySetInnerHTML={{
                    __html: generateHTML(internalNotes as JSONContent),
                  }}
                />
              )}
            </TabsContent>
            {["purchaseOrder", "purchaseInvoice"].includes(table) && (
              <TabsContent value="external">
                {permissions.can("update", "sales") ? (
                  <Editor
                    initialValue={(externalNotes ?? {}) as JSONContent}
                    onUpload={onUploadImage}
                    onChange={(value) => {
                      setExternalNotes(value);
                      onUpdateExternalNotes(value);
                    }}
                  />
                ) : (
                  <div
                    className="prose dark:prose-invert"
                    dangerouslySetInnerHTML={{
                      __html: generateHTML(externalNotes as JSONContent),
                    }}
                  />
                )}
              </TabsContent>
            )}
          </CardContent>
        </Tabs>
      </Card>
    </>
  );
};

export default SupplierInteractionNotes;
