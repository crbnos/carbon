// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import {
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
import { useLoaderData, useNavigate } from "react-router";
import { z } from "zod";
import { useRealtime } from "~/hooks";
import { PrintJobsTable } from "~/modules/settings/ui";
import { decodeOffsetToken, encodeOffsetToken } from "~/utils/cursor";
import { listErrorPage } from "~/utils/list-registry/load.server";
import { PAGE_SIZE } from "~/utils/pagination";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "printing-jobs");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { filters } = getGenericQueryFilters(searchParams);
  // `getPrintJobs` pages by offset, so the `after` token holds the next offset.
  const offset = decodeOffsetToken(searchParams.get("after"));

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
    // One extra row tells whether a next page exists.
    limit: PAGE_SIZE + 1,
    offset
  });

  if (result.error) {
    logger.error("Failed to load print jobs", {
      companyId,
      offset,
      error: result.error
    });
    if (offset > 0) return listErrorPage("jobs");
  }

  const jobs = (result.data ?? []) as PrintJob[];
  return {
    jobs: jobs.slice(0, PAGE_SIZE),
    count: result.count ?? 0,
    nextCursor:
      jobs.length > PAGE_SIZE ? encodeOffsetToken(offset + PAGE_SIZE) : null
  };
}

// The table's row menu posts one intent per action.
const printJobForm = z.discriminatedUnion("intent", [
  reprintValidator.extend({ intent: z.literal("reprint") }),
  z.object({
    intent: z.literal("delete"),
    printJobId: z.string().min(1, { message: "Print job ID required" })
  }),
  z.object({
    intent: z.literal("viewContent"),
    printJobId: z.string().min(1, { message: "Print job ID required" })
  })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(printJobForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  switch (input.data.intent) {
    case "reprint":
      return api.settings.reprintPrintJob(input.data);
    case "delete":
      return api.settings.deletePrintJob(input.data);
    case "viewContent":
      return api.settings.viewPrintJobContent(input.data);
  }
}

export default function PrintJobsRoute() {
  const { jobs, count, nextCursor } = useLoaderData<typeof loader>();
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
        <DrawerBody className="p-0 max-md:p-0">
          <PrintJobsTable jobs={jobs} count={count} nextCursor={nextCursor} />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
