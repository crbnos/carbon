import type { LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deleteAttribute } from "~/modules/people";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

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
