import type { JSONContent } from "@carbon/react";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { getPickingList, getPickingListLines } from "~/modules/inventory";
import {
  PickingListLines,
  PickingListNotes
} from "~/modules/inventory/ui/PickingLists";
import { path } from "~/utils/path";

type PickingListData = NonNullable<
  Awaited<ReturnType<typeof getPickingList>>["data"]
>;

type PickingListLineData = NonNullable<
  Awaited<ReturnType<typeof getPickingListLines>>["data"]
>;

export default function PickingListDetailsRoute() {
  const { pickingListId } = useParams();
  if (!pickingListId) throw new Error("Could not find pickingListId");

  const routeData = useRouteData<{
    pickingList: PickingListData;
    pickingListLines: PickingListLineData;
  }>(path.to.pickingList(pickingListId));

  if (!routeData?.pickingList)
    throw new Error("Could not find picking list in routeData");

  return (
    <>
      <PickingListLines
        pickingListLines={routeData.pickingListLines}
        pickingListId={pickingListId}
        pickingList={routeData.pickingList}
      />
      <PickingListNotes
        id={pickingListId}
        notes={(routeData.pickingList.notes ?? {}) as JSONContent}
      />
    </>
  );
}
