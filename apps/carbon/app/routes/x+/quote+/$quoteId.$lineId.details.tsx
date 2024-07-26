import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Editor,
  toast,
  useDebounce,
} from "@carbon/react";
import { validationError, validator } from "@carbon/remix-validated-form";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData, useParams } from "@remix-run/react";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import { CadModel } from "~/modules/items";
import type { QuotationLine } from "~/modules/sales";
import {
  getFilesByQuoteLineId,
  getQuoteLine,
  quotationPricingValidator,
  QuoteLineDocuments,
  QuoteLineForm,
  quoteLineValidator,
  updateQuoteLinePrice,
  upsertQuoteLine,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const [line, files] = await Promise.all([
    getQuoteLine(client, lineId),
    getFilesByQuoteLineId(client, companyId, lineId),
  ]);

  if (line.error) {
    throw redirect(
      path.to.quote(quoteId),
      await flash(request, error(line.error, "Failed to load line"))
    );
  }

  return json({
    line: line.data,
    files: files?.data ?? [],
  });
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "line") {
    const validation = await validator(quoteLineValidator).validate(formData);

    if (validation.error) {
      return validationError(validation.error);
    }

    const { id, ...data } = validation.data;

    const updateQuotationLine = await upsertQuoteLine(client, {
      id: lineId,
      ...data,
      updatedBy: userId,
      customFields: setCustomFields(formData),
    });

    if (updateQuotationLine.error) {
      throw redirect(
        path.to.quoteLine(quoteId, lineId),
        await flash(
          request,
          error(updateQuotationLine.error, "Failed to update quote line")
        )
      );
    }
  } else if (intent === "pricing") {
    const validation = await validator(quotationPricingValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const updateLinePrice = await updateQuoteLinePrice(client, {
      quoteId,
      quoteLineId: lineId,
      ...validation.data,
      updatedBy: userId,
    });

    if (updateLinePrice.error) {
      throw redirect(
        path.to.quoteLine(quoteId, lineId),
        await flash(
          request,
          error(updateLinePrice.error, "Failed to update quote line price")
        )
      );
    }
  }

  throw redirect(path.to.quoteLine(quoteId, lineId));
}

export default function QuoteLine() {
  const { line, files } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const initialValues = {
    ...line,
    id: line.id ?? undefined,
    quoteId: line.quoteId ?? "",
    estimatorId: line.estimatorId ?? "",
    customerPartId: line.customerPartId ?? "",
    customerPartRevision: line.customerPartRevision ?? "",
    status: line.status ?? "Draft",
    itemId: line.itemId ?? "",
    itemReadableId: line.itemReadableId ?? "",
    description: line.description ?? "",
    methodType: line.methodType ?? "Make",
    unitOfMeasureCode: line.unitOfMeasureCode ?? "",
    modelUploadId: line.modelUploadId ?? undefined,
  };

  return (
    <>
      <QuoteLineForm key={initialValues.id} initialValues={initialValues} />
      {permissions.is("employee") && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 w-full flex-grow gap-2 ">
            <CadModel
              autodeskUrn={line?.autodeskUrn ?? null}
              metadata={{ quoteLineId: line.id ?? undefined }}
              modelPath={line?.modelPath ?? null}
              title="CAD Model"
              uploadClassName="min-h-[360px]"
              viewerClassName="min-h-[360px]"
            />
            <QuoteLineDocuments
              files={files ?? []}
              quoteId={quoteId}
              quoteLineId={lineId}
              modelUpload={line ?? undefined}
            />
          </div>
          <QuoteLineNotes line={line} />
          <Outlet />
        </>
      )}
    </>
  );
}

const QuoteLineNotes = ({ line }: { line: QuotationLine }) => {
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();
  const { supabase } = useSupabase();

  const onUploadImage = async (file: File) => {
    const fileName = `${companyId}/quote-line/${line.id}/${encodeURIComponent(
      file.name
    )}`;
    const result = await supabase?.storage
      .from("private")
      .upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return `/file/preview/private/${result.data.path}`;
  };

  const onUpdateInternalNotes = useDebounce(async (content: JSONContent) => {
    await supabase
      ?.from("quoteLine")
      .update({
        notes: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", line.id!);
  }, 3000);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal Notes</CardTitle>
      </CardHeader>
      <CardContent>
        <Editor
          initialValue={(line.notes ?? {}) as JSONContent}
          onUpload={onUploadImage}
          onChange={onUpdateInternalNotes}
        />
      </CardContent>
    </Card>
  );
};
