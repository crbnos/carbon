// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  RichTextView,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useDebounce
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { useImageUpload, usePermissions, useUser } from "~/hooks";

const ShipmentNotes = ({
  id,
  internalNotes: initialInternalNotes,
  externalNotes: initialExternalNotes
}: {
  id: string | null;
  internalNotes?: JSONContent;
  externalNotes?: JSONContent;
}) => {
  const { id: userId } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();
  const [tab, setTab] = useState("internal");
  const [internalNotes, setInternalNotes] = useState(
    initialInternalNotes ?? {}
  );
  const [externalNotes, setExternalNotes] = useState(
    initialExternalNotes ?? {}
  );

  const onUploadImage = useImageUpload(`inventory/${id}`);

  const onUpdateExternalNotes = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("shipment")
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
        ?.from("shipment")
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
                <Trans>Shipping Notes</Trans>
              </CardTitle>
            </CardHeader>
            <CardAction>
              <TabsList>
                <TabsTrigger value="internal">
                  <Trans>Internal</Trans>
                </TabsTrigger>
                <TabsTrigger value="external">
                  <Trans>External</Trans>
                </TabsTrigger>
              </TabsList>
            </CardAction>
          </HStack>
          <CardContent>
            <TabsContent value="internal">
              {permissions.can("update", "inventory") ? (
                <Editor
                  initialValue={(internalNotes ?? {}) as JSONContent}
                  onUpload={onUploadImage}
                  onChange={(value) => {
                    setInternalNotes(value);
                    onUpdateInternalNotes(value);
                  }}
                />
              ) : (
                <RichTextView
                  content={internalNotes as JSONContent}
                  empty={<Trans>No internal notes</Trans>}
                />
              )}
            </TabsContent>
            <TabsContent value="external">
              {permissions.can("update", "inventory") ? (
                <Editor
                  initialValue={(externalNotes ?? {}) as JSONContent}
                  onUpload={onUploadImage}
                  onChange={(value) => {
                    setExternalNotes(value);
                    onUpdateExternalNotes(value);
                  }}
                />
              ) : (
                <RichTextView
                  content={externalNotes as JSONContent}
                  empty={<Trans>No external notes</Trans>}
                />
              )}
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </>
  );
};

export default ShipmentNotes;
