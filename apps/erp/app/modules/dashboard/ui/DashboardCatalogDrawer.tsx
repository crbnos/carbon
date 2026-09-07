import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Switch,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { useAllModules } from "~/hooks";
import { path } from "~/utils/path";
import { useWidgetLabels } from "../dashboard.labels";
import type { ResolvedWidget, WidgetKey } from "../dashboard.models";

/**
 * Show/hide every widget the user is permitted to see, grouped by module.
 * Draft → Save writes one row per permitted widget (explicit values, so a
 * later change to a registry default never flips a choice the user made).
 */
export function DashboardCatalogDrawer({
  open,
  onClose,
  widgets
}: {
  open: boolean;
  onClose: () => void;
  widgets: ResolvedWidget[];
}) {
  const { t } = useLingui();
  const widgetLabels = useWidgetLabels();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const modules = useAllModules();

  const [draft, setDraft] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (open) {
      setDraft(Object.fromEntries(widgets.map((w) => [w.key, w.visible])));
    }
  }, [open, widgets]);

  const isDirty = widgets.some((w) => draft[w.key] !== w.visible);
  const isSaving = fetcher.state !== "idle";

  // biome-ignore lint/correctness/useExhaustiveDependencies: close once the save settles
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      revalidator.revalidate();
      onClose();
    }
  }, [fetcher.state, fetcher.data]);

  const groups = useMemo(() => {
    const byModule = new Map<string, ResolvedWidget[]>();
    for (const w of widgets) {
      byModule.set(w.module, [...(byModule.get(w.module) ?? []), w]);
    }
    return [...byModule.entries()].map(([module, items]) => ({
      module,
      name:
        modules.find((m) => m.key === module || m.permission === module)
          ?.name ?? module,
      items
    }));
  }, [widgets, modules]);

  const save = () => {
    fetcher.submit(
      JSON.stringify({
        widgets: widgets.map((w) => ({
          key: w.key,
          visible: draft[w.key] ?? w.visible,
          range: w.range
        }))
      }),
      {
        method: "post",
        action: path.to.api.dashboardLayout,
        encType: "application/json"
      }
    );
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            <Trans>Customize analytics</Trans>
          </DrawerTitle>
          <DrawerDescription>
            <Trans>Choose which widgets appear on your home page.</Trans>
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <VStack spacing={4}>
            {groups.map((group) => (
              <VStack key={group.module} spacing={2}>
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.name}
                </h3>
                {group.items.map((w) => {
                  const labels = widgetLabels[w.key as WidgetKey];
                  return (
                    <label
                      key={w.key}
                      className="flex items-center justify-between gap-4 w-full py-1 cursor-pointer"
                    >
                      <span className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate">
                          {labels.title}
                        </span>
                        <span className="text-xs text-muted-foreground truncate">
                          {labels.description}
                        </span>
                      </span>
                      <Switch
                        checked={draft[w.key] ?? w.visible}
                        onCheckedChange={(checked) =>
                          setDraft((prev) => ({ ...prev, [w.key]: checked }))
                        }
                      />
                    </label>
                  );
                })}
              </VStack>
            ))}
          </VStack>
        </DrawerBody>
        <DrawerFooter>
          <HStack>
            <Button
              variant="solid"
              onClick={save}
              isDisabled={!isDirty || isSaving}
              isLoading={isSaving}
            >
              {t`Save`}
            </Button>
            <Button variant="secondary" onClick={onClose} isDisabled={isSaving}>
              {t`Cancel`}
            </Button>
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
