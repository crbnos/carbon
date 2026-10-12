// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
  Combobox,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Spinner,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import type {
  BuildFromPartPreview,
  BuildFromPartResult
} from "~/routes/x+/project+/$projectId.elements.build";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { BuildFromPartSource } from "../../projects.models";
import {
  BUILD_FROM_PART_MAX_DEPTH,
  buildFromPartSources
} from "../../projects.models";
import { SerialSelect } from "../Element/SerialSelect";
import { ElementTypeIcon } from "./ElementTypeIcon";

type ParentOption = {
  id: string;
  readableId: string;
  name: string;
  type: string;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
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

  const sourceLabels: Record<BuildFromPartSource, string> = {
    Serial: t`Serial`,
    Item: t`Item`,
    Template: t`Template`
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

  // Serial: items tracked by serial. Item: items with a make method.
  const itemOptions = useMemo(
    () =>
      items
        .filter(
          (item) =>
            item.active &&
            (source === "Serial"
              ? item.itemTrackingType === "Serial"
              : item.replenishmentSystem !== "Buy")
        )
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

  const depthOf = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const depths = new Map<string, number>();
    for (const row of rows) {
      const parent = row.parentId ? byId.get(row.parentId) : undefined;
      depths.set(row.id, parent ? (depths.get(parent.id) ?? 0) + 1 : 0);
    }
    return depths;
  }, [rows]);

  const parentOptions = [
    { value: "", label: t`Top level` },
    ...elements
      .filter((element) => element.type !== "Parameter")
      .map((element) => ({
        value: element.id,
        label: element.readableId,
        helper: element.name
      }))
  ];

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>
            <Trans>Build from part</Trans>
          </DrawerTitle>
          <DrawerDescription>
            <Trans>
              Create System elements from a serial's build history, an item's
              bill of materials or a template.
            </Trans>
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <VStack spacing={4}>
            <Field label={t`Source`}>
              <Combobox
                asButton
                value={source}
                options={buildFromPartSources.map((value) => ({
                  value,
                  label: sourceLabels[value]
                }))}
                onChange={(next) => {
                  if (!next) return;
                  setSource(next as BuildFromPartSource);
                  setItemId(null);
                  setTrackedEntityId(null);
                }}
              />
            </Field>
            {source !== "Template" && (
              <Field label={t`Item`}>
                <Combobox
                  asButton
                  value={itemId ?? ""}
                  options={itemOptions}
                  placeholder={t`Choose an item`}
                  onChange={(next) => {
                    setItemId(next || null);
                    setTrackedEntityId(null);
                  }}
                />
              </Field>
            )}
            {source === "Serial" && itemId && (
              <Field label={t`Serial`}>
                <SerialSelect
                  itemId={itemId}
                  value={trackedEntityId}
                  isReadOnly={false}
                  onChange={setTrackedEntityId}
                />
              </Field>
            )}
            {source === "Template" && (
              <Field label={t`Template`}>
                <Combobox
                  asButton
                  value={templateProjectId ?? ""}
                  options={(data?.templates ?? []).map((template) => ({
                    value: template.id,
                    label: template.name,
                    helper: template.identifier ?? undefined
                  }))}
                  placeholder={t`Choose a template`}
                  onChange={(next) => setTemplateProjectId(next || null)}
                />
              </Field>
            )}
            <Field label={t`Depth`}>
              <Combobox
                asButton
                value={String(depth)}
                options={Array.from(
                  { length: BUILD_FROM_PART_MAX_DEPTH },
                  (_, index) => ({
                    value: String(index + 1),
                    label: String(index + 1)
                  })
                )}
                onChange={(next) => next && setDepth(Number(next))}
              />
            </Field>
            {source !== "Template" && (
              <Switch
                variant="small"
                label={t`Include bought components`}
                checked={includeBought}
                onCheckedChange={setIncludeBought}
              />
            )}
            <Field label={t`Parent element`}>
              <Combobox
                asButton
                value={parentId ?? ""}
                options={parentOptions}
                onChange={(next) => setParentId(next || null)}
              />
            </Field>

            {(data?.error || submitError) && (
              <Alert variant="destructive">
                <LuTriangleAlert />
                <AlertDescription>
                  {submitError ?? data?.error}
                </AlertDescription>
              </Alert>
            )}

            <Field label={t`Preview`}>
              {isLoading && !data ? (
                <div className="flex h-24 items-center justify-center">
                  <Spinner />
                </div>
              ) : !data?.preview ? (
                <p className="text-sm text-muted-foreground">
                  <Trans>Choose a source to see the elements it creates.</Trans>
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm">
                    <Plural
                      value={rows.length}
                      one="# element will be created"
                      other="# elements will be created"
                    />
                  </p>
                  {data.preview.skippedLines > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      <Plural
                        value={data.preview.skippedLines}
                        one="# bill of materials line is left out: its item has no cost record"
                        other="# bill of materials lines are left out: their items have no cost record"
                      />
                    </p>
                  )}
                  {rows.length > 0 && (
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
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {row.readableId}
                          </span>
                          <span className="truncate">{row.name}</span>
                          {row.itemId && (
                            <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                              {itemLabel.get(row.itemId)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Field>
          </VStack>
        </DrawerBody>
        <DrawerFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            isLoading={submitFetcher.state !== "idle"}
            isDisabled={
              rows.length === 0 || isLoading || submitFetcher.state !== "idle"
            }
            onClick={() =>
              submitFetcher.submit(params, {
                method: "post",
                action: buildPath
              })
            }
          >
            <Trans>Create elements</Trans>
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
