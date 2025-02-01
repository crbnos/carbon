import { error, useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  useDebounce,
  VStack,
} from "@carbon/react";
import { Editor, generateHTML } from "@carbon/react/Editor";
import { getLocalTimeZone, today } from "@internationalized/date";
import { json, redirect, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { useState } from "react";
import { LuCircleCheck } from "react-icons/lu";
import { usePermissions, useUser } from "~/hooks";
import { getTerms } from "~/modules/settings";

import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Purchasing",
  to: path.to.purchasingSettings,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
  });

  const terms = await getTerms(client, companyId);
  if (terms.error) {
    throw redirect(
      path.to.settings,
      await flash(request, error(terms.error, "Failed to load terms"))
    );
  }

  return json({
    terms: terms.data,
  });
}

export default function Terms() {
  const { terms } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();

  const [purchasingTermsStatus, setPurchasingTermsStatus] = useState<
    "saved" | "draft"
  >("saved");

  const handleUpdatePurchasingTerms = (content: JSONContent) => {
    setPurchasingTermsStatus("draft");
    onUpdatePurchasingTerms(content);
  };
  const onUpdatePurchasingTerms = useDebounce(
    async (content: JSONContent) => {
      if (!carbon) return;
      const { error } = await carbon
        .from("terms")
        .update({
          purchasingTerms: content,
          updatedAt: today(getLocalTimeZone()).toString(),
          updatedBy: userId,
        })
        .eq("id", companyId);
      if (!error) setPurchasingTermsStatus("saved");
    },
    2500,
    true
  );

  const onUploadImage = async (file: File) => {
    // Implement image upload logic here
    // This is a placeholder function
    console.error("Image upload not implemented", file);
    return "";
  };

  return (
    <VStack spacing={2} className="p-2 h-full">
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Purchasing Terms &amp; Conditions</CardTitle>
            <CardDescription>
              Define the terms and conditions for purchase orders
            </CardDescription>
          </CardHeader>
          <CardAction className="py-6">
            {purchasingTermsStatus === "draft" ? (
              <Badge variant="secondary">Draft</Badge>
            ) : (
              <LuCircleCheck className="w-4 h-4 text-emerald-500" />
            )}
          </CardAction>
        </HStack>
        <CardContent>
          {permissions.can("update", "settings") ? (
            <Editor
              initialValue={(terms.purchasingTerms ?? {}) as JSONContent}
              onUpload={onUploadImage}
              onChange={handleUpdatePurchasingTerms}
            />
          ) : (
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(terms.purchasingTerms as JSONContent),
              }}
            />
          )}
        </CardContent>
      </Card>
    </VStack>
  );
}
