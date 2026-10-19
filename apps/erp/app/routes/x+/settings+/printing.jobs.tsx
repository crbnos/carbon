// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
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
        <DrawerBody className="p-0 max-md:p-0">
          <PrintJobsTable jobs={jobs} count={count} />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
