import { Spinner } from "@carbon/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useMemo } from "react";
import { useFetcher, useSearchParams } from "react-router";
import type { FlatTreeItem } from "~/components/TreeView";
import { ConsumableProperties } from "~/modules/items/ui/Consumables";
import { MaterialProperties } from "~/modules/items/ui/Materials";
import { PartProperties } from "~/modules/items/ui/Parts";
import { ToolProperties } from "~/modules/items/ui/Tools";
import type { loader as itemPropertiesLoader } from "~/routes/x+/items+/$itemId.properties";
import { path } from "~/utils/path";
import type { MakeMethod, Method } from "../../types";

export function SelectedItemProperties({
  topLevelItemId,
  methods
}: {
  topLevelItemId: string;
  methods: FlatTreeItem<Method>[];
}) {
  const [searchParams] = useSearchParams();
  const materialId = searchParams.get("materialId");

  const selectedNode = useMemo(
    () =>
      materialId
        ? methods.find((m) => m.data.methodMaterialId === materialId)
        : undefined,
    [materialId, methods]
  );

  const selectedItemId = selectedNode?.data.itemId ?? null;
  const selectedItemType = selectedNode?.data.itemType ?? null;
  const isTopLevel =
    !selectedNode ||
    !!selectedNode.data.isRoot ||
    selectedItemId === topLevelItemId;

  const fetcher = useFetcher<typeof itemPropertiesLoader>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  useEffect(() => {
    if (isTopLevel || !selectedItemId || !selectedItemType) return;
    fetcher.load(
      `${path.to.itemProperties(selectedItemId)}?type=${selectedItemType}`
    );
  }, [selectedItemId, selectedItemType, isTopLevel]);

  const filesPromise = useMemo(
    () => Promise.resolve(fetcher.data?.files ?? []),
    [fetcher.data]
  );
  const makeMethodsPromise = useMemo(
    () =>
      Promise.resolve({
        data:
          fetcher.data && "makeMethods" in fetcher.data
            ? fetcher.data.makeMethods
            : [],
        error: null
      } as unknown as PostgrestResponse<MakeMethod>),
    [fetcher.data]
  );

  if (isTopLevel) {
    return <PartProperties key={topLevelItemId} />;
  }

  const d = fetcher.data;
  const ready = d && d.itemId === selectedItemId;
  if (!ready || fetcher.state === "loading") {
    return (
      <div className="flex w-96 items-center justify-center bg-card h-full border-l border-border">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const common = {
    itemId: d.itemId,
    locations: d.locations,
    files: filesPromise,
    supplierParts: d.supplierParts,
    pickMethods: d.pickMethods,
    tags: d.tags
  };

  switch (d.type) {
    case "Material":
      return (
        <MaterialProperties
          key={d.itemId}
          data={{ ...common, materialSummary: d.summary }}
        />
      );
    case "Tool":
      return (
        <ToolProperties
          key={d.itemId}
          data={{
            ...common,
            makeMethods: makeMethodsPromise,
            toolSummary: d.summary
          }}
        />
      );
    case "Consumable":
      return (
        <ConsumableProperties
          key={d.itemId}
          data={{ ...common, consumableSummary: d.summary }}
        />
      );
    default:
      return (
        <PartProperties
          key={d.itemId}
          data={{
            ...common,
            makeMethods: makeMethodsPromise,
            partSummary: d.summary
          }}
        />
      );
  }
}
