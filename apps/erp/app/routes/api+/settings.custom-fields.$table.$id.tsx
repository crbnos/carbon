import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { table, id } = params;

  if (!table || !id)
    return json({
      data: [],
    });

  const values = await client.rpc("get_custom_field_unique_values", {
    table_name: table,
    field_key: id,
    company_id: companyId,
  });
  if (values.error) {
    return json(
      [],
      await flash(
        request,
        error(values.error, "Failed to get unique values for custom field")
      )
    );
  }

  const options = values.data.map((value) => ({
    id: value.value,
    name: value.value,
  }));

  return json({ data: options, error: null });
}
