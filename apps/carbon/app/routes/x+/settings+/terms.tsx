import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Editor,
  generateHTML,
  HStack,
  useThrottle,
  VStack,
} from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { json, redirect, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { useState } from "react";
import { LuCheckCircle } from "react-icons/lu";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import { getTerms } from "~/modules/settings";

import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Terms",
  to: path.to.terms,
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
  const { supabase } = useSupabase();
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();

  const [purchasingTermsStatus, setPurchasingTermsStatus] = useState<
    "saved" | "draft"
  >("saved");
  const [salesTermsStatus, setSalesTermsStatus] = useState<"saved" | "draft">(
    "saved"
  );

  const handleUpdatePurchasingTerms = (content: JSONContent) => {
    setPurchasingTermsStatus("draft");
    onUpdatePurchasingTerms(content);
  };
  const onUpdatePurchasingTerms = useThrottle(async (content: JSONContent) => {
    if (!supabase) return;
    const { error } = await supabase
      .from("terms")
      .update({
        purchasingTerms: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", companyId);
    if (!error) setPurchasingTermsStatus("saved");
  }, 2500);

  const handleUpdateSalesTerms = (content: JSONContent) => {
    setSalesTermsStatus("draft");
    onUpdateSalesTerms(content);
  };
  const onUpdateSalesTerms = useThrottle(async (content: JSONContent) => {
    setSalesTermsStatus("draft");
    await supabase
      ?.from("terms")
      .update({
        salesTerms: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", companyId);
    setSalesTermsStatus("saved");
  }, 2500);

  const onUploadImage = async (file: File) => {
    // Implement image upload logic here
    // This is a placeholder function
    console.log("Image upload not implemented", file);
    return "";
  };

  return (
    <VStack spacing={4} className="p-4 h-full">
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
              <LuCheckCircle className="w-4 h-4 text-green-500" />
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
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Sales Terms &amp; Conditions</CardTitle>
            <CardDescription>
              Define the terms and conditions for quotes and sales orders
            </CardDescription>
          </CardHeader>
          <CardAction className="py-6">
            {salesTermsStatus === "draft" ? (
              <Badge variant="secondary">Draft</Badge>
            ) : (
              <LuCheckCircle className="w-4 h-4 text-green-500" />
            )}
          </CardAction>
        </HStack>
        <CardContent>
          {permissions.can("update", "settings") ? (
            <Editor
              initialValue={(terms.salesTerms ?? {}) as JSONContent}
              onUpload={onUploadImage}
              onChange={handleUpdateSalesTerms}
            />
          ) : (
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(terms.salesTerms as JSONContent),
              }}
            />
          )}
        </CardContent>
      </Card>
    </VStack>
  );
}
