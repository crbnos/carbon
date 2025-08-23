import { useCarbon } from "@carbon/auth";
import { OnshapeLogo } from "@carbon/ee";
import {
  Badge,
  Button,
  Combobox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  PulsingDot,
  Spinner,
  Status,
  cn,
  toast,
  useDisclosure,
  useMount,
} from "@carbon/react";
import { formatDateTime } from "@carbon/utils";
import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuChevronRight } from "react-icons/lu";
import { MethodIcon } from "~/components";
import { OnshapeStatus } from "~/components/Icons";
import { methodType } from "~/modules/shared";
import type { action as onShapeSyncAction } from "~/routes/api+/integrations.onshape.sync";
import { path } from "~/utils/path";

interface TreeNode {
  data: TreeData;
  children: TreeNode[];
  level: number;
}

interface TreeData {
  id?: string;
  index: string;
  readableId: string;
  readableIdWithRevision: string;
  name?: string;
  quantity: number;
  unitOfMeasure: string;
  replenishmentSystem: string;
  defaultMethodType: string;
  level: number;
  data: Record<string, any>;
}

export const OnshapeSync = ({
  itemId,
  makeMethodId,
  isDisabled,
}: {
  itemId: string;
  makeMethodId: string;
  isDisabled: boolean;
}) => {
  const [initialized, setInitialized] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [elementId, setElementId] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const { carbon } = useCarbon();
  useMount(() => {
    if (!carbon) {
      toast.error("Failed to load item data");
      return;
    }
    carbon
      ?.from("item")
      .select("externalId")
      .eq("id", itemId)
      .single()
      .then(({ data }) => {
        const externalId = data?.externalId as Record<string, any>;
        setDocumentId(externalId.onshape?.documentId);
        setVersionId(externalId.onshape?.versionId);
        setElementId(externalId.onshape?.elementId);
        setLastSyncedAt(externalId.onshape?.lastSyncedAt);
      });
  });

  const [bomRows, setBomRows] = useState<TreeData[]>([]);
  const disclosure = useDisclosure();

  const documentsFetcher = useFetcher<
    | { data: { items: { id: string; name: string }[] }; error: null }
    | { data: null; error: string }
  >({});

  useEffect(() => {
    if (!isDisabled && initialized) {
      documentsFetcher.load(path.to.api.onShapeDocuments);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized]);

  useEffect(() => {
    if (documentsFetcher.data?.error) {
      toast.error(documentsFetcher.data.error);
    }
  }, [documentsFetcher.data]);

  const documentOptions =
    useMemo(() => {
      return (
        documentsFetcher.data?.data?.items
          ?.map((c) => ({
            value: c.id,
            label: c.name,
          }))
          .sort((a, b) => a.label.localeCompare(b.label)) ?? []
      );
    }, [documentsFetcher.data]) ?? [];

  const versionsFetcher = useFetcher<
    | { data: { id: string; name: string }[]; error: null }
    | { data: null; error: string }
  >({});

  useEffect(() => {
    if (documentId && !isDisabled && initialized) {
      versionsFetcher.load(path.to.api.onShapeVersions(documentId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, initialized]);

  const versionOptions =
    useMemo(() => {
      return (
        versionsFetcher.data?.data
          ?.map((c) => ({
            value: c.id,
            label: c.name,
          }))
          .sort((a, b) => a.label.localeCompare(b.label)) ?? []
      );
    }, [versionsFetcher.data]) ?? [];

  const elementsFetcher = useFetcher<
    | { data: { id: string; name: string }[]; error: null }
    | { data: null; error: string }
  >({});

  useEffect(() => {
    if (documentId && versionId && !isDisabled && initialized) {
      elementsFetcher.load(path.to.api.onShapeElements(documentId, versionId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, versionId, initialized]);

  const elementOptions =
    useMemo(() => {
      return (
        elementsFetcher.data?.data?.map((c) => ({
          value: c.id,
          label: c.name,
        })) ?? []
      );
    }, [elementsFetcher.data]) ?? [];

  const isDataLoading =
    documentsFetcher.state === "loading" ||
    versionsFetcher.state === "loading" ||
    elementsFetcher.state === "loading";

  const isReadyForSync =
    documentId &&
    versionId &&
    elementId &&
    documentOptions.some((c) => c.value === documentId) &&
    versionOptions.some((c) => c.value === versionId) &&
    elementOptions.some((c) => c.value === elementId);

  const bomFetcher = useFetcher<
    | { data: null; error: string }
    | {
        data: {
          tree: TreeNode[];
          rows: TreeData[];
        };
        error: null;
      }
  >();

  useEffect(() => {
    if (bomFetcher.data?.data?.rows) {
      setBomRows(bomFetcher.data.data.rows);
    }
  }, [bomFetcher.data]);

  const loadBom = () => {
    if (isReadyForSync) {
      bomFetcher.load(path.to.api.onShapeBom(documentId, versionId, elementId));
    }
  };

  const upsertBomFetcher = useFetcher<typeof onShapeSyncAction>();
  const syncSubmitted = useRef(false);
  const saveBom = () => {
    syncSubmitted.current = true;
    const formData = new FormData();
    formData.append("documentId", documentId ?? "");
    formData.append("versionId", versionId ?? "");
    formData.append("elementId", elementId ?? "");
    formData.append("makeMethodId", makeMethodId);
    formData.append("rows", JSON.stringify(bomRows));
    upsertBomFetcher.submit(formData, {
      method: "post",
      action: path.to.api.onShapeSync,
    });
  };

  useEffect(() => {
    if (
      syncSubmitted.current &&
      upsertBomFetcher.data?.success &&
      bomRows.length > 0
    ) {
      setBomRows([]);
      setLastSyncedAt(new Date().toISOString());
      syncSubmitted.current = false;
      toast.success("BOM synced successfully");
    }

    if (upsertBomFetcher.data?.success === false) {
      toast.error(upsertBomFetcher.data.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bomRows.length, upsertBomFetcher.data]);

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex flex-col gap-2 border bg-muted/30 rounded p-2 w-full">
        <div className="flex items-center w-full justify-between">
          <OnshapeLogo className="h-5 w-auto" />
          <IconButton
            aria-label="Show sync options"
            variant="ghost"
            size="sm"
            icon={<LuChevronRight />}
            className={cn(disclosure.isOpen && "rotate-90")}
            onClick={disclosure.onToggle}
          />
        </div>

        {disclosure.isOpen && (
          <>
            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Document:</span>
              <div className="w-[180px]">
                <Combobox
                  isLoading={documentsFetcher.state === "loading"}
                  options={documentOptions}
                  disabled={isDisabled}
                  onChange={(value) => {
                    setVersionId(null);
                    setElementId(null);
                    setDocumentId(value);
                  }}
                  size="sm"
                  className="text-xs"
                  value={documentId ?? undefined}
                />
              </div>
            </div>

            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Version:</span>
              <div className="w-[180px]">
                <Combobox
                  isLoading={versionsFetcher.state === "loading"}
                  disabled={isDisabled}
                  options={versionOptions}
                  onChange={(value) => {
                    setVersionId(value);
                    setElementId(null);
                  }}
                  size="sm"
                  className="text-xs"
                  value={versionId ?? undefined}
                />
              </div>
            </div>

            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Element:</span>
              <div className="w-[180px]">
                <Combobox
                  isLoading={elementsFetcher.state === "loading"}
                  options={elementOptions}
                  disabled={isDisabled}
                  onChange={(value) => {
                    setElementId(value);
                  }}
                  size="sm"
                  className="text-xs"
                  value={elementId ?? undefined}
                />
              </div>
            </div>

            {/* <div className="flex w-full items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Sync mode:</span>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    id="manual"
                    name="syncMode"
                    value="manual"
                    className="h-4 w-4 text-primary border-muted-foreground focus:ring-primary"
                    defaultChecked={mode === "manual"}
                  />
                  <label htmlFor="manual" className="text-xs cursor-pointer">
                    Manual
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    id="automatic"
                    name="syncMode"
                    value="automatic"
                    className="h-4 w-4 text-primary border-muted-foreground focus:ring-primary"
                    defaultChecked={mode === "automatic"}
                  />
                  <label htmlFor="automatic" className="text-xs cursor-pointer">
                    Automatic
                  </label>
                </div>
              </div>
            </div> */}
          </>
        )}
        <div className="flex items-center gap-1 w-full justify-between">
          {lastSyncedAt ? (
            <span className="text-xs text-muted-foreground">
              Last synced: {formatDateTime(lastSyncedAt)}
            </span>
          ) : (
            <div />
          )}
          {isDataLoading ? (
            <Spinner className="size-3" />
          ) : (
            <div className="flex gap-2">
              {!initialized && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setInitialized(true)}
                  isDisabled={isDisabled}
                >
                  Fetch
                </Button>
              )}
              <Button
                variant={bomRows.length > 0 ? "secondary" : "primary"}
                isLoading={bomFetcher.state !== "idle"}
                isDisabled={
                  isDisabled ||
                  !isReadyForSync ||
                  bomFetcher.state !== "idle" ||
                  !initialized
                }
                size="sm"
                onClick={loadBom}
              >
                {bomRows.length > 0 ? "Refresh" : "Sync"}
              </Button>
            </div>
          )}
        </div>
      </div>
      {bomRows.length > 0 && (
        <div className="flex flex-col gap-2 border bg-muted/30 rounded p-2 w-full">
          <HStack className="w-full justify-between">
            <span className="text-xs text-muted-foreground font-light mb-1">
              Bill of Materials
            </span>
            <Button
              size="sm"
              onClick={saveBom}
              isLoading={upsertBomFetcher.state !== "idle"}
              isDisabled={isDisabled || upsertBomFetcher.state !== "idle"}
            >
              Save
            </Button>
          </HStack>

          <div className="max-h-60 overflow-y-auto flex flex-col">
            {bomRows.map((row) => {
              const isSynced = row.id;
              const partId = row.readableIdWithRevision || row.name;
              return (
                <div
                  key={row.index}
                  className={cn(
                    "flex min-h-8 cursor-pointer items-center overflow-hidden rounded-sm pr-2 w-full gap-1 hover:bg-muted/90"
                  )}
                  style={{
                    paddingLeft: `${row.level * 12}px`,
                  }}
                >
                  <div
                    className={cn(
                      "flex items-center gap-2 font-medium text-sm w-full"
                    )}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger>
                        <MethodIcon type={row.defaultMethodType} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuRadioGroup
                          value={row.defaultMethodType}
                          onValueChange={(value) => {
                            setBomRows((prevRows) =>
                              prevRows.map((r) =>
                                r.index === row.index
                                  ? { ...r, defaultMethodType: value }
                                  : r
                              )
                            );
                          }}
                        >
                          {methodType.map((type) => (
                            <DropdownMenuRadioItem key={type} value={type}>
                              <DropdownMenuIcon
                                icon={<MethodIcon type={type} />}
                              />
                              {type}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    {partId ? (
                      <span className="line-clamp-1">
                        {row.readableIdWithRevision || row.name}
                      </span>
                    ) : (
                      <Status color="red">No part ID</Status>
                    )}
                    {!isSynced && partId && <PulsingDot className="mt-0.5" />}
                    {row.data["State"] && (
                      <OnshapeStatus status={row.data["State"]} />
                    )}
                  </div>
                  <HStack spacing={1}>
                    <Badge className="text-xs" variant="outline">
                      {row.quantity}
                    </Badge>
                  </HStack>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
