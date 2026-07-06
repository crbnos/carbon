import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, VStack } from "@carbon/react";
import { LuCirclePlus } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useNavigate } from "react-router";
import { usePermissions } from "~/hooks";
import { getFixedAssetClassesList, getFixedAssets } from "~/modules/accounting";
import { FixedAssetsTable } from "~/modules/accounting/ui/FixedAssets";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Fixed Assets",
  to: path.to.fixedAssets
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status") as
    | "Draft"
    | "Active"
    | "Fully Depreciated"
    | "Disposed"
    | null;
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [assets, assetClasses] = await Promise.all([
    getFixedAssets(client, companyId, {
      search,
      status,
      limit,
      offset,
      sorts,
      filters
    }),
    getFixedAssetClassesList(client, companyId)
  ]);

  return {
    data: assets.data ?? [],
    count: assets.count ?? 0,
    assetClasses: assetClasses.data ?? []
  };
}

export default function FixedAssetsRoute() {
  const { data, count, assetClasses } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const navigate = useNavigate();

  return (
    <VStack spacing={0} className="h-full">
      <FixedAssetsTable
        data={data}
        count={count}
        assetClasses={assetClasses}
        primaryAction={
          permissions.can("create", "accounting") && (
            <Button
              leftIcon={<LuCirclePlus />}
              variant="primary"
              onClick={() => navigate(path.to.newFixedAsset)}
            >
              Add Fixed Asset
            </Button>
          )
        }
      />
      <Outlet />
    </VStack>
  );
}
