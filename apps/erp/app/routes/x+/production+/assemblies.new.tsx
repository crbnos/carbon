// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { assemblyInstructionFromItemValidator } from "~/modules/production/production.models";
import AssemblyInstructionForm from "~/modules/production/ui/Assemblies/AssemblyInstructionForm";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "production"
  });

  const url = new URL(request.url);

  return {
    initialValues: {
      itemId: url.searchParams.get("itemId") ?? ""
    }
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(assemblyInstructionFromItemValidator).request(
    args
  );
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.production.createAssemblyInstruction({
    itemId: input.data.itemId,
    modelUploadId: input.data.modelUploadId
  });
  // A model-backed instruction generates its steps on open: the explorer
  // sees ?autogen=1 and submits Generate once. A refusal stays on the form.
  const url = new URL(args.request.url);
  return respond(args.request, result).redirect(
    result.data
      ? `${path.to.assemblyInstruction(result.data.id)}${result.data.autogen ? "?autogen=1" : ""}`
      : `${url.pathname}${url.search}`,
    { message: "Assembly instruction created" }
  );
}

export default function NewAssemblyInstructionRoute() {
  const { initialValues } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <AssemblyInstructionForm
      initialValues={initialValues}
      onClose={() => navigate(path.to.assemblyInstructions)}
    />
  );
}
