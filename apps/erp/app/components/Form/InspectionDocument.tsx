import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { HStack } from "@carbon/react";
import { useEffect, useMemo } from "react";
import { useFetcher } from "react-router";
import type { getInspectionDocumentsForItem } from "~/modules/production/production.service";
import { path } from "~/utils/path";

type InspectionDocumentSelectProps = Omit<ComboboxProps, "options"> & {
  itemId?: string;
};

const InspectionDocument = ({
  itemId,
  ...props
}: InspectionDocumentSelectProps) => {
  const { options, loading } = useInspectionDocuments({ itemId });

  return (
    <Combobox
      options={options}
      isOptional={props?.isOptional ?? true}
      isLoading={loading}
      {...props}
      label={props?.label ?? "Inspection Plan"}
    />
  );
};

InspectionDocument.displayName = "InspectionDocument";

export default InspectionDocument;

export const useInspectionDocuments = (args: { itemId?: string }) => {
  const { itemId } = args;
  const inspectionDocumentFetcher =
    useFetcher<Awaited<ReturnType<typeof getInspectionDocumentsForItem>>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher.load is not referentially stable; reload only when itemId changes
  useEffect(() => {
    if (itemId) {
      inspectionDocumentFetcher.load(path.to.api.inspectionDocuments(itemId));
    }
  }, [itemId]);

  const loading = inspectionDocumentFetcher.state !== "idle";

  const options = useMemo(
    () =>
      itemId && inspectionDocumentFetcher.data?.data
        ? inspectionDocumentFetcher.data.data.map((c) => ({
            value: c.id,
            label: (
              <div className="flex justify-between items-center gap-1 w-full">
                <HStack className="items-end">
                  <span className="text-sm truncate">
                    {c.drawingNumber ?? c.fileName ?? c.id}{" "}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    v{c.version}
                  </span>
                </HStack>
              </div>
            )
          }))
        : [],
    [inspectionDocumentFetcher.data, itemId]
  );

  return { options, loading };
};
