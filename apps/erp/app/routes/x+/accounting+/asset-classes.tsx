import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, VStack } from "@carbon/react";
import { LuCirclePlus } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useNavigate } from "react-router";
import { usePermissions } from "~/hooks";
import { getFixedAssetClasses } from "~/modules/accounting";
import { AssetClassesTable } from "~/modules/accounting/ui/FixedAssets";
import { getCompanySettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Asset Classes",
  to: path.to.assetClasses
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [classes, companySettings] = await Promise.all([
    getFixedAssetClasses(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getCompanySettings(client, companyId)
  ]);

  return {
    data: classes.data ?? [],
    count: classes.count ?? 0,
    taxDepreciationEnabled:
      (companySettings.data as any)?.assetTaxDepreciationEnabled ?? false
  };
}

export default function AssetClassesRoute() {
  const { data, count, taxDepreciationEnabled } =
    useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const navigate = useNavigate();

  return (
    <VStack spacing={0} className="h-full">
      <AssetClassesTable
        data={data}
        count={count}
        taxDepreciationEnabled={taxDepreciationEnabled}
        primaryAction={
          permissions.can("create", "accounting") && (
            <Button
              leftIcon={<LuCirclePlus />}
              variant="primary"
              onClick={() => navigate(path.to.newAssetClass)}
            >
              Add Asset Class
            </Button>
          )
        }
      />
      <Outlet />
    </VStack>
  );
}
