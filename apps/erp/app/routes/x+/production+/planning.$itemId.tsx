import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Button,
  ResizableHandle,
  ResizablePanel,
  ScrollArea,
  VStack,
} from "@carbon/react";
import { useRouteData, useUrlParams } from "@carbon/remix";
import { Link, useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { LuExternalLink, LuX } from "react-icons/lu";
import { useUser } from "~/hooks/useUser";
import { getItem } from "~/modules/items/items.service";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) {
    throw new Error("itemId not found");
  }

  const item = await getItem(client, itemId);

  return json({ item: item.data });
}

export default function ProductionPlanningDetailsRoute() {
  const { itemId } = useParams();
  if (!itemId) {
    throw new Error("itemId not found");
  }

  const { item } = useLoaderData<typeof loader>();

  const routeData = useRouteData<{ locationId: string }>(
    path.to.productionPlanning
  );

  const navigate = useNavigate();
  const [params] = useUrlParams();
  const { defaults } = useUser();

  return (
    <>
      <ResizableHandle withHandle />
      <ResizablePanel
        defaultSize={50}
        maxSize={70}
        minSize={25}
        className="bg-muted"
      >
        <ScrollArea className="h-[calc(100dvh-49px)]">
          <div className="w-full">
            <div className="flex justify-between items-center border-b border-border p-2 bg-card w-full">
              <Button
                isIcon
                variant="ghost"
                onClick={() =>
                  navigate(`${path.to.productionPlanning}?${params.toString()}`)
                }
              >
                <LuX className="w-4 h-4" />
              </Button>
              {item && (
                <span className="flex items-center font-semibold text-center">
                  {item.readableIdWithRevision ?? item.readableId}{" "}
                  <Link
                    to={getLinkToItemDetails(item.type as "Part", itemId)}
                    className="ml-2"
                  >
                    <LuExternalLink />
                  </Link>
                </span>
              )}
              <div />
            </div>
          </div>
          <VStack className="p-2" spacing={2}>
            <ItemPlanningChart
              key={itemId}
              itemId={itemId}
              locationId={routeData?.locationId ?? defaults.locationId ?? ""}
            />
          </VStack>
        </ScrollArea>
      </ResizablePanel>
    </>
  );
}
