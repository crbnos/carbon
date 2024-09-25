import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deleteAttribute } from "~/modules/people";
import { path } from "~/utils/path";

export async function action({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "people",
  });

  const { attributeId } = params;
  if (!attributeId) {
    throw redirect(
      path.to.attributes,
      await flash(request, error(params, "Failed to get an attribute id"))
    );
  }

  const deactivateAttribute = await deleteAttribute(client, attributeId);
  if (deactivateAttribute.error) {
    throw redirect(
      path.to.attributes,
      await flash(
        request,
        error(deactivateAttribute.error, "Failed to deactivate attribute")
      )
    );
  }

  throw redirect(
    path.to.attributes,
    await flash(request, success("Successfully deactivated attribute"))
  );
}
