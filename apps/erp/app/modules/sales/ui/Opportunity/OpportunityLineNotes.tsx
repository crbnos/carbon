import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  generateHTML,
  HStack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useDebounce
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useImageUpload, usePermissions, useUser } from "~/hooks";

const OpportunityLineNotes = ({
  id,
  table,
  title,
  subTitle,
  isReadOnly: isReadOnlyProp,
  internalNotes: initialInternalNotes,
  externalNotes: initialExternalNotes
}: {
  id: string | null;
  table: "salesRfqLine" | "quoteLine" | "salesOrderLine" | "salesInvoiceLine";
  title: string;
  subTitle: string;
  isReadOnly?: boolean;
  internalNotes?: JSONContent;
  externalNotes?: JSONContent;
}) => {
  const { id: userId } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();
  const isEmployee = permissions.is("employee");
  const { t } = useLingui();
  const canEdit = !isReadOnlyProp && permissions.can("update", "sales");
  const [tab, setTab] = useState(isEmployee ? "internal" : "external");
  const [internalNotes, setInternalNotes] = useState(
    initialInternalNotes ?? {}
  );
  const [externalNotes, setExternalNotes] = useState(
    initialExternalNotes ?? {}
  );

  const onUploadImage = useImageUpload(`opportunity-line/${id}`);

  const onUpdateExternalNotes = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from(table)
        .update({
          externalNotes: content,
          updatedAt: today(getLocalTimeZone()).toString(),
          updatedBy: userId
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
          updatedBy: userId
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
              <CardTitle>
                <Trans>Notes</Trans>
              </CardTitle>
              <CardDescription>
                {subTitle} -{" "}
                {tab === "internal" ? t`Internal Notes` : t`External Notes`}
              </CardDescription>
            </CardHeader>
            <CardAction>
              {isEmployee && (
                <TabsList>
                  <TabsTrigger value="internal">
                    <Trans>Internal</Trans>
                  </TabsTrigger>
                  <TabsTrigger value="external">
                    <Trans>External</Trans>
                  </TabsTrigger>
                </TabsList>
              )}
            </CardAction>
          </HStack>
          <CardContent>
            <TabsContent value="internal">
              {canEdit ? (
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
                    __html: generateHTML(internalNotes as JSONContent)
                  }}
                />
              )}
            </TabsContent>
            <TabsContent value="external">
              {canEdit ? (
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
                    __html: generateHTML(externalNotes as JSONContent)
                  }}
                />
              )}
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </>
  );
};

export default OpportunityLineNotes;
