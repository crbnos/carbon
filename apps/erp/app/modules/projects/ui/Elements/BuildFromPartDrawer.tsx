// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useControlField, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerDescription,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  Spinner,
  toast,
  VStack
} from "@carbon/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  Boolean,
  Combobox,
  NumberControlled,
  Select,
  Submit
} from "~/components/Form";
import type {
  BuildFromPartPreview,
  BuildFromPartResult
} from "~/routes/x+/project+/$projectId.elements.build";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { BuildFromPartSource } from "../../projects.models";
import {
  BUILD_FROM_PART_MAX_DEPTH,
  buildFromPartValidator
} from "../../projects.models";
import { useSerialOptions } from "../Element/SerialSelect";
import { ElementTypeIcon } from "./ElementTypeIcon";

type ParentOption = {
  id: string;
  readableId: string;
  name: string;
  type: string;
};

type ItemRow = ReturnType<typeof useItems>[0][number];

/** A serial source lists serial-tracked items; an item source, made items. */
function fitsSource(item: ItemRow, source: BuildFromPartSource) {
  if (!item.active) return false;
  return source === "Serial"
    ? item.itemTrackingType === "Serial"
    : item.replenishmentSystem !== "Buy";
}

/**
 * Build from part: creates System elements from a serial's build history,
 * an item's make method or a template's elements, under a parent element.
 * The preview lists what the build creates before anything is written.
 */
export function BuildFromPartDrawer({
  projectId,
  elements,
  defaultParentId,
  endpoint,
  initial,
  onClose
}: {
  projectId: string;
  /** The project's elements, for the parent picker. */
  elements: ParentOption[];
  /** The element open in the peek, if any. */
  defaultParentId: string | null;
  /** The route that previews (GET) and builds (POST); the project's by default. */
  endpoint?: string;
  /** The source to start from, such as a service order's unit. */
  initial?: {
    source: BuildFromPartSource;
    itemId?: string | null;
    trackedEntityId?: string | null;
  };
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [items] = useItems();
  const buildPath = endpoint ?? path.to.projectElementsBuild(projectId);
  const [source, setSource] = useState<BuildFromPartSource>(
    initial?.source ?? "Item"
  );
  const [itemId, setItemId] = useState<string | null>(initial?.itemId ?? null);
  const [trackedEntityId, setTrackedEntityId] = useState<string | null>(
    initial?.trackedEntityId ?? null
  );
  const [templateProjectId, setTemplateProjectId] = useState<string | null>(
    null
  );
  const [depth, setDepth] = useState(2);
  const [includeBought, setIncludeBought] = useState(false);
  const [parentId, setParentId] = useState<string | null>(
    defaultParentId &&
      elements.some((e) => e.id === defaultParentId && e.type !== "Parameter")
      ? defaultParentId
      : null
  );

  const changeSource = (next: BuildFromPartSource) => {
    setSource(next);
    setTrackedEntityId(null);
    // Keep the item when the new source lists it.
    const item = items.find((row) => row.id === itemId);
    if (next === "Template" || !item || !fitsSource(item, next)) {
      setItemId(null);
    }
  };

  const params = useMemo(() => {
    const query = new URLSearchParams({
      source,
      depth: String(depth),
      includeBought: String(includeBought)
    });
    if (parentId) query.set("parentId", parentId);
    if (source === "Serial" && trackedEntityId) {
      query.set("trackedEntityId", trackedEntityId);
    }
    if (source === "Item" && itemId) query.set("itemId", itemId);
    if (source === "Template" && templateProjectId) {
      query.set("templateProjectId", templateProjectId);
    }
    return query;
  }, [
    source,
    depth,
    includeBought,
    parentId,
    trackedEntityId,
    itemId,
    templateProjectId
  ]);
  const query = params.toString();

  const previewFetcher = useFetcher<BuildFromPartPreview>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload on a new query only
  useEffect(() => {
    previewFetcher.load(`${buildPath}?${query}`);
  }, [buildPath, query]);

  const submitFetcher = useAction<BuildFromPartResult>({
    onSuccess: (result) => {
      const count = result.count ?? 0;
      toast.success(t`Created ${count} elements from the part`);
      onClose();
    }
  });
  const submitError =
    submitFetcher.state === "idle"
      ? submitFetcher.data?.error?.message
      : undefined;

  const data = previewFetcher.data;
  const rows = data?.preview?.rows ?? [];
  const isLoading = previewFetcher.state !== "idle";

  const itemOptions = useMemo(
    () =>
      items
        .filter((item) => fitsSource(item, source))
        .map((item) => ({
          value: item.id,
          label: item.readableIdWithRevision,
          helper: item.name
        })),
    [items, source]
  );
  const itemLabel = useMemo(
    () => new Map(items.map((item) => [item.id, item.readableIdWithRevision])),
    [items]
  );
  const serialOptions = useSerialOptions(
    source === "Serial" && itemId ? itemId : undefined
  );
  const serialLabel =
    serialOptions.find((option) => option.value === trackedEntityId)?.label ??
    t`This serial`;

  const sourceOptions: { value: BuildFromPartSource; label: string }[] = [
    { value: "Serial", label: t`A serial's build history` },
    { value: "Item", label: t`An item's bill of materials` },
    { value: "Template", label: t`A template` }
  ];

  const parentOptions = elements
    .filter((element) => element.type !== "Parameter")
    .map((element) => ({
      value: element.id,
      label: element.readableId,
      helper: element.name
    }));

  const depthOf = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const depths = new Map<string, number>();
    for (const row of rows) {
      const parent = row.parentId ? byId.get(row.parentId) : undefined;
      depths.set(row.id, parent ? (depths.get(parent.id) ?? 0) + 1 : 0);
    }
    return depths;
  }, [rows]);

  // Why a chosen source builds nothing, and what to try instead.
  const emptyReason =
    source === "Serial" ? (
      <Trans>
        {serialLabel} has no components recorded in Carbon. Build from the
        item's bill of materials instead.
      </Trans>
    ) : !includeBought && source === "Item" ? (
      <Trans>
        The item has no made components at this depth. Include bought components
        to add its purchased parts.
      </Trans>
    ) : (
      <Trans>The source has nothing to build at this depth.</Trans>
    );

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer open onOpenChange={(open) => !open && onClose()}>
        <ModalDrawerContent>
          <ValidatedForm
            validator={buildFromPartValidator}
            method="post"
            action={buildPath}
            fetcher={submitFetcher}
            defaultValues={{
              source,
              itemId: itemId ?? "",
              trackedEntityId: trackedEntityId ?? "",
              depth,
              includeBought,
              parentId: parentId ?? ""
            }}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Build from Part</Trans>
              </ModalDrawerTitle>
              <ModalDrawerDescription>
                <Trans>
                  Add the components of a serial, an item or a template as
                  elements.
                </Trans>
              </ModalDrawerDescription>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <Select
                  name="source"
                  label={t`Build from`}
                  options={sourceOptions}
                  onChange={(next) =>
                    next && changeSource(next.value as BuildFromPartSource)
                  }
                />
                {source !== "Template" && (
                  <Combobox
                    name="itemId"
                    label={t`Item`}
                    isRequired
                    placeholder={t`Choose an item`}
                    options={itemOptions}
                    value={itemId ?? ""}
                    onChange={(next) => {
                      setItemId(next?.value ?? null);
                      setTrackedEntityId(null);
                    }}
                  />
                )}
                {source === "Serial" && (
                  <Combobox
                    name="trackedEntityId"
                    label={t`Serial`}
                    isRequired
                    isReadOnly={!itemId}
                    placeholder={
                      itemId ? t`Search by serial` : t`Choose the item first`
                    }
                    options={serialOptions}
                    value={trackedEntityId ?? ""}
                    onChange={(next) => setTrackedEntityId(next?.value ?? null)}
                  />
                )}
                {source === "Template" && (
                  <Combobox
                    name="templateProjectId"
                    label={t`Template`}
                    isRequired
                    placeholder={t`Choose a template`}
                    options={(data?.templates ?? []).map((template) => ({
                      value: template.id,
                      label: template.name,
                      helper: template.identifier ?? undefined
                    }))}
                    value={templateProjectId ?? ""}
                    onChange={(next) =>
                      setTemplateProjectId(next?.value ?? null)
                    }
                  />
                )}
                <NumberControlled
                  name="depth"
                  label={t`Levels`}
                  isRequired
                  helperText={t`How many levels of components below the part`}
                  minValue={1}
                  maxValue={BUILD_FROM_PART_MAX_DEPTH}
                  value={depth}
                  onChange={(next) => {
                    if (Number.isFinite(next)) setDepth(next);
                  }}
                />
                {source !== "Template" && (
                  <Boolean
                    name="includeBought"
                    label={t`Include bought components`}
                    onChange={setIncludeBought}
                  />
                )}
                <Combobox
                  name="parentId"
                  label={t`Add under`}
                  placeholder={t`Top level`}
                  isOptional
                  options={parentOptions}
                  value={parentId ?? ""}
                  onChange={(next) => setParentId(next?.value ?? null)}
                />

                {(data?.error || submitError) && (
                  <Alert variant="destructive">
                    <LuTriangleAlert />
                    <AlertDescription>
                      {submitError ?? data?.error}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex w-full flex-col gap-2 border-t border-border pt-4">
                  {isLoading && !data ? (
                    <div className="flex h-24 items-center justify-center">
                      <Spinner />
                    </div>
                  ) : !data?.preview ? (
                    <p className="text-sm text-muted-foreground">
                      <Trans>Choose what to build from to see a preview.</Trans>
                    </p>
                  ) : rows.length === 0 ? (
                    <div className="flex flex-col items-start gap-2">
                      <p className="text-sm font-medium">
                        <Trans>Nothing to build</Trans>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {emptyReason}
                      </p>
                      {source === "Serial" && itemId && (
                        <UseBillOfMaterialsButton
                          onSwitch={() => changeSource("Item")}
                        />
                      )}
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium">
                        <Plural
                          value={rows.length}
                          one="Creates # element"
                          other="Creates # elements"
                        />
                      </p>
                      {data.preview.skippedLines > 0 && (
                        <p className="text-xs text-muted-foreground">
                          <Plural
                            value={data.preview.skippedLines}
                            one="# bill of materials line is left out: its item has no cost record"
                            other="# bill of materials lines are left out: their items have no cost record"
                          />
                        </p>
                      )}
                      <ul className="flex max-h-[40dvh] flex-col overflow-y-auto rounded-lg border border-border py-1 text-sm">
                        {rows.map((row) => (
                          <li
                            key={row.id}
                            className="flex min-w-0 items-center gap-2 py-1 pr-3"
                            style={{
                              paddingLeft: `${0.75 + (depthOf.get(row.id) ?? 0) * 1.25}rem`
                            }}
                          >
                            <ElementTypeIcon type={row.type} />
                            <span className="truncate">{row.name}</span>
                            {row.itemId && (
                              <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                                {itemLabel.get(row.itemId)}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={rows.length === 0 || isLoading}>
                  <Trans>Create Elements</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
}

/** Switches the form's source to the item's bill of materials. */
function UseBillOfMaterialsButton({ onSwitch }: { onSwitch: () => void }) {
  const [, setSourceField] = useControlField<string>("source");
  return (
    <Button
      variant="secondary"
      onClick={() => {
        setSourceField("Item");
        onSwitch();
      }}
    >
      <Trans>Use the Bill of Materials</Trans>
    </Button>
  );
}
