import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import {
  createPrintJob,
  getPrintJob,
  getPrintJobContent,
  getPrintJobs,
  type PrintJob,
  reprintValidator
} from "@carbon/printing";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useNavigate } from "react-router";
import { useRealtime } from "~/hooks";
import { PrintJobsTable } from "~/modules/settings";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, filters } = getGenericQueryFilters(searchParams);

  const status = filters?.find((f) => f.column === "status")?.value;
  const origin = filters?.find((f) => f.column === "origin")?.value;
  const sourceDocument = filters?.find(
    (f) => f.column === "sourceDocument"
  )?.value;
  const contentType = filters?.find((f) => f.column === "contentType")?.value;

  const result = await getPrintJobs(client, companyId, {
    status,
    origin,
    sourceDocument,
    contentType,
    search,
    limit,
    offset
  });

  return {
    jobs: (result.data ?? []) as PrintJob[],
    count: result.count ?? 0
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "reprint": {
      const validation = reprintValidator.safeParse(
        Object.fromEntries(formData)
      );
      if (!validation.success)
        return data(
          { success: false, message: "Invalid reprint request" },
          await flash(request, error(null, "Invalid reprint request"))
        );

      const { printJobId, printerUrl: overrideUrl } = validation.data;

      const original = await getPrintJobContent(client, printJobId, companyId);
      const originalMeta = await getPrintJob(client, printJobId, companyId);
      if (
        original.error ||
        !original.data ||
        originalMeta.error ||
        !originalMeta.data
      )
        return data(
          { success: false, message: "Failed to load print job" },
          await flash(
            request,
            error(
              original.error ?? originalMeta.error,
              "Failed to load print job"
            )
          )
        );

      if (!original.data.content || !original.data.contentType)
        return data(
          { success: false, message: "Cannot reprint a job with no content" },
          await flash(
            request,
            error(null, "Cannot reprint a job that is still generating")
          )
        );

      const newJob = await createPrintJob(client, {
        companyId,
        contentType: original.data.contentType as "zpl" | "pdf",
        content: original.data.content,
        printerUrl: overrideUrl || originalMeta.data.printerUrl,
        sourceDocument: originalMeta.data.sourceDocument,
        sourceDocumentId: originalMeta.data.sourceDocumentId,
        sourceDocumentReadableId:
          originalMeta.data.sourceDocumentReadableId ?? undefined,
        description: originalMeta.data.description,
        status: "queued",
        origin: "reprint",
        createdBy: userId
      });

      if (newJob.error || !newJob.data)
        return data(
          { success: false, message: "Failed to create reprint job" },
          await flash(request, error(newJob.error, "Failed to create reprint"))
        );

      try {
        await trigger("print-job-deliver", {
          printJobId: newJob.data.id,
          companyId
        });
      } catch (e) {
        console.error("Failed to trigger delivery:", e);
      }

      return data(
        { success: true, message: "Reprint job created" },
        await flash(request, success("Reprint job created"))
      );
    }

    case "delete": {
      const printJobId = formData.get("printJobId") as string;
      if (!printJobId)
        return data(
          { success: false, message: "Print job ID required" },
          await flash(request, error(null, "Print job ID required"))
        );

      const result = await client
        .from("printJob")
        .delete()
        .eq("id", printJobId)
        .eq("companyId", companyId);

      if (result.error)
        return data(
          { success: false, message: result.error.message },
          await flash(request, error(result.error, "Failed to delete job"))
        );

      return data(
        { success: true, message: "Print job deleted" },
        await flash(request, success("Print job deleted"))
      );
    }

    case "viewContent": {
      const printJobId = formData.get("printJobId") as string;
      if (!printJobId)
        return { success: false, message: "Print job ID required" };

      const content = await getPrintJobContent(client, printJobId, companyId);
      if (content.error || !content.data)
        return { success: false, message: "Failed to load content" };

      return {
        success: true,
        content: content.data.content,
        contentType: content.data.contentType,
        printJobId: content.data.id
      };
    }
  }

  return { success: false, message: "Unknown intent" };
}

export default function PrintJobsRoute() {
  const { jobs, count } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  useRealtime("printJob");

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) {
          navigate(path.to.printingSettings);
        }
      }}
    >
      <DrawerContent size="full">
        <DrawerHeader>
          <DrawerTitle>
            <Trans>Print Jobs</Trans>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="p-0">
          <PrintJobsTable jobs={jobs} count={count} />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
