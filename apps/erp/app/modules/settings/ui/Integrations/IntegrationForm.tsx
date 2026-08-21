import type {
  IntegrationAction,
  IntegrationSetting,
  IntegrationSettingGroup,
  IntegrationSettingOption
} from "@carbon/ee";
import { integrations as availableIntegrations } from "@carbon/ee";
import {
  ChoiceCardGroup,
  Array as FormArray,
  Input,
  Number as NumberInput,
  Password,
  Select,
  Submit,
  useControlField,
  ValidatedForm
} from "@carbon/form";
import {
  Badge,
  Button,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  Heading,
  HStack,
  ScrollArea,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  VStack
} from "@carbon/react";
import { SUPPORT_EMAIL } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { Processes } from "~/components/Form";
import { MethodIcon, TrackingTypeIcon } from "~/components/Icons";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";

function IntegrationActionButton({
  action,
  isDisabled
}: {
  action: IntegrationAction;
  isDisabled: boolean;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "running" | "completed">(
    "idle"
  );

  const handleClick = useCallback(async () => {
    setIsLoading(true);
    setStatus("running");

    try {
      const response = await fetch(action.endpoint, { method: "POST" });
      const data = await response.json();

      if (data.success) {
        toast.success(`${action.label} started`);
        setStatus("completed");
      } else {
        setStatus("idle");
        toast.error(data.error || `Failed to start ${action.label}`);
      }
    } catch {
      setStatus("idle");
      toast.error(`Failed to start ${action.label}`);
    } finally {
      setIsLoading(false);
    }
  }, [action]);

  return (
    <div className="flex items-center justify-between gap-4 p-3 border rounded-lg w-full">
      <div className="flex flex-col flex-1 min-w-0">
        <p className="text-sm font-medium">{action.label}</p>
        <p className="text-xs text-muted-foreground">{action.description}</p>
      </div>
      <div className="shrink-0">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleClick}
          isLoading={isLoading}
          isDisabled={isDisabled || status === "running"}
        >
          {status === "completed" ? "Started" : "Run"}
        </Button>
      </div>
    </div>
  );
}

// Wraps an action gated by a boolean setting (`enabledWhenSetting`), reading the
// LIVE form value so it appears/disappears as the toggle changes — not only after
// save. Renders nothing when the setting is off.
function GatedIntegrationActionButton({
  action,
  isDisabled
}: {
  action: IntegrationAction;
  isDisabled: boolean;
}) {
  const [value] = useControlField<boolean>(action.enabledWhenSetting as string);
  if (value !== true) return null;
  return <IntegrationActionButton action={action} isDisabled={isDisabled} />;
}

/**
 * Fills runtime placeholders in a setting's help text — the webhook host and
 * company ID that only exist at render time. Lets a static config description
 * (e.g. Rillet's webhook URL `https://<your-carbon-host>/api/webhook/rillet/<your company ID>`)
 * render as a concrete, copy-pasteable URL.
 */
function fillSettingPlaceholders(
  description: string | undefined,
  host: string,
  companyId: string
): string | undefined {
  if (!description) return description;
  return description
    .replaceAll("<your-carbon-host>", host || "<your-carbon-host>")
    .replaceAll("<your company ID>", companyId);
}

/**
 * Helper to normalize option to consistent format
 */
function normalizeOption(option: IntegrationSettingOption) {
  if (typeof option === "string") {
    return { value: option, label: option };
  }
  return option;
}

/**
 * Wrapper that hides a setting field when its `visibleWhen` condition
 * does not match the current value of the referenced field.
 *
 * Must be mounted as a dedicated component so `useControlField` is only
 * called when `visibleWhen` is defined (satisfies the rules of hooks).
 */
function ConditionalSettingField({ setting }: { setting: IntegrationSetting }) {
  const condition = setting.visibleWhen!;
  const [value] = useControlField<unknown>(condition.field);
  const current = value == null ? "" : String(value);
  const equals = Array.isArray(condition.equals)
    ? condition.equals
    : [condition.equals];
  if (!equals.includes(current)) return null;
  return <SettingFieldInner setting={setting} />;
}

/**
 * Renders a single setting field based on its type,
 * honouring any `visibleWhen` gating.
 */
function SettingField({ setting }: { setting: IntegrationSetting }) {
  if (setting.visibleWhen) {
    return <ConditionalSettingField setting={setting} />;
  }
  return <SettingFieldInner setting={setting} />;
}

function SettingFieldInner({ setting }: { setting: IntegrationSetting }) {
  switch (setting.type) {
    case "text":
      return (
        <div className="w-full">
          <Input
            name={setting.name}
            label={setting.label}
            isOptional={!setting.required}
          />
          {setting.description && (
            <p className="text-xs text-muted-foreground mt-1.5">
              {setting.description}
            </p>
          )}
        </div>
      );

    case "number":
      return (
        <div className="w-full">
          <NumberInput
            name={setting.name}
            label={setting.label}
            isRequired={setting.required}
          />
          {setting.description && (
            <p className="text-xs text-muted-foreground mt-1.5">
              {setting.description}
            </p>
          )}
        </div>
      );

    case "password":
      return (
        <div className="w-full">
          <Password name={setting.name} label={setting.label} />
          {setting.description && (
            <p className="text-xs text-muted-foreground mt-1.5">
              {setting.description}
            </p>
          )}
        </div>
      );

    // A vault-backed credential. The stored secret is never sent to the
    // browser, so the field loads empty: leaving it empty keeps the vaulted
    // value, typing a new one replaces it. Rendered as a plain `Password`
    // (which has its own show/hide toggle) — no separate "Reveal" affordance.
    case "secret":
      return (
        <div className="w-full">
          <Password name={setting.name} label={setting.label} />
          {setting.description && (
            <p className="text-xs text-muted-foreground mt-1.5">
              {setting.description}
            </p>
          )}
        </div>
      );

    case "cards":
      return <CardSelector setting={setting} />;

    case "switch":
      return <SwitchField setting={setting} />;

    case "processes":
      return (
        <div className="w-full">
          <Processes name={setting.name} label={setting.label} />
          {setting.description && (
            <p className="text-xs text-muted-foreground mt-1">
              {setting.description}
            </p>
          )}
        </div>
      );

    case "array":
      return (
        <div className="w-full">
          <FormArray name={setting.name} label={setting.label} />
          {setting.description && (
            <p className="text-xs text-muted-foreground mt-1">
              {setting.description}
            </p>
          )}
        </div>
      );

    case "options": {
      const listOptions = setting.listOptions ?? [];

      // Small static enums render as Choice cards (the same affordance as
      // the explicit `cards` type). Long / dynamically-loaded lists keep
      // the dropdown so things like Xero account pickers stay usable.
      if (
        listOptions.length > 0 &&
        listOptions.length <= CHOICE_CARD_MAX_OPTIONS
      ) {
        return <CardSelector setting={setting} />;
      }

      const options = listOptions.map((option) => {
        const normalized = normalizeOption(option);
        const icon = getOptionIcon(setting.name, normalized.value);

        // Build a simpler label that works well with Radix Select
        const label = (
          <span key={normalized.value} className="flex items-center gap-2">
            {icon}
            <span className="font-medium">{normalized.label}</span>
            {normalized.description && (
              <span className="text-muted-foreground text-xs">
                — {normalized.description}
              </span>
            )}
          </span>
        );

        return {
          label,
          value: normalized.value
        };
      });

      return (
        <div className="w-full">
          <Select name={setting.name} label={setting.label} options={options} />
          {setting.description && (
            <p className="text-xs text-muted-foreground mt-1">
              {setting.description}
            </p>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}

/**
 * Card-style picker for mutually-exclusive options. Wraps the shared
 * `ChoiceCardGroup` and binds it into the surrounding ValidatedForm via
 * `useControlField` + a hidden input so the value gets serialized on submit.
 *
 * Used for both the explicit `cards` setting type and for small (≤5) static
 * `options` lists, so the integration form picks the right affordance based
 * on payload size — Choice cards for tight enums, dropdowns for long /
 * dynamically-loaded lists (e.g. Xero account codes).
 */
function CardSelector({ setting }: { setting: IntegrationSetting }) {
  const [value, setValue] = useControlField<string>(setting.name);
  const options = (setting.listOptions ?? []).map(normalizeOption);
  const current = value == null ? "" : String(value);

  return (
    <div className="w-full">
      {setting.label && (
        <div className="flex flex-col gap-0.5 pb-2">
          <div className="text-sm font-medium text-foreground">
            {setting.label}
          </div>
          {setting.description && (
            <p className="text-xs text-muted-foreground">
              {setting.description}
            </p>
          )}
        </div>
      )}
      <ChoiceCardGroup
        value={current}
        onChange={setValue}
        options={options.map((option) => ({
          value: option.value,
          title: option.label,
          description: option.description,
          icon: getOptionIcon(setting.name, option.value) ?? option.icon
        }))}
      />
      {/* Hidden input keeps the value in form data on submit */}
      <input type="hidden" name={setting.name} value={current} />
    </div>
  );
}

/**
 * Boolean toggle bound to the surrounding ValidatedForm.
 *
 * We deliberately don't reuse `@carbon/form`'s `Boolean`, because that one
 * leans on Radix's built-in hidden checkbox — which only posts a value when
 * *checked*, so an unchecked switch sends nothing and any `.default(true)`
 * in the Zod schema quietly reasserts `true` on save. Users then can't turn
 * the field off (e.g. the Email integration's "Use TLS" switch stayed stuck
 * on).
 *
 * Instead, we drive the `Switch` as a controlled component via
 * `useControlField` and emit our own hidden input that *always* contains
 * either `"true"` or `"false"`, so the posted form data is unambiguous.
 * Schemas consuming these fields need to preprocess the string into a
 * boolean (see `packages/ee/src/email/config.tsx`).
 */
function SwitchField({ setting }: { setting: IntegrationSetting }) {
  const [value, setValue] = useControlField<boolean>(setting.name);
  const checked = value === true;

  return (
    <div className="flex items-center justify-between gap-4 w-full p-3 border rounded-lg">
      <div className="flex flex-col flex-1">
        <span className="text-sm font-medium">{setting.label}</span>
        {setting.description && (
          <span className="text-xs text-muted-foreground">
            {setting.description}
          </span>
        )}
      </div>
      <div className="shrink-0">
        <Switch
          checked={checked}
          onCheckedChange={setValue}
          aria-label={setting.label}
        />
        <input
          type="hidden"
          name={setting.name}
          value={checked ? "true" : "false"}
        />
      </div>
    </div>
  );
}

/**
 * Legacy icon support for specific field names that historically rendered
 * a leading glyph in the Select dropdown. Returns null when there's no
 * registered icon so ChoiceCardGroup just omits the icon slot.
 */
function getOptionIcon(
  settingName: string,
  optionValue: string
): JSX.Element | null {
  if (settingName === "methodType") {
    return <MethodIcon type={optionValue} />;
  }
  if (settingName === "trackingType") {
    return <TrackingTypeIcon type={optionValue} />;
  }

  return null;
}

/** Threshold for switching `options` from a Select dropdown to ChoiceCardGroup. */
const CHOICE_CARD_MAX_OPTIONS = 5;

/**
 * Wrapper that hides an entire group when every setting in it is gated
 * by the same `visibleWhen` field and none of them are currently visible.
 * Only mounted when the group actually shares a single `visibleWhen` field.
 */
function GatedSettingsGroup({
  name,
  description,
  settings,
  controlledField
}: {
  name: string;
  description?: string;
  settings: IntegrationSetting[];
  controlledField: string;
}) {
  const [value] = useControlField<unknown>(controlledField);
  const current = value == null ? "" : String(value);
  const anyVisible = settings.some((s) => {
    const eq = s.visibleWhen!.equals;
    const equals = Array.isArray(eq) ? eq : [eq];
    return equals.includes(current);
  });
  if (!anyVisible) return null;
  return (
    <SettingsGroup name={name} description={description} settings={settings} />
  );
}

/**
 * Decides whether a group should be gated behind a shared `visibleWhen`
 * condition, and renders the appropriate component.
 */
function ConditionalSettingsGroup({
  name,
  description,
  settings
}: {
  name: string;
  description?: string;
  settings: IntegrationSetting[];
}) {
  const firstCondition = settings[0]?.visibleWhen;
  const sharesCondition =
    firstCondition !== undefined &&
    settings.every(
      (s) => s.visibleWhen && s.visibleWhen.field === firstCondition.field
    );

  if (sharesCondition) {
    return (
      <GatedSettingsGroup
        name={name}
        description={description}
        settings={settings}
        controlledField={firstCondition!.field}
      />
    );
  }

  return (
    <SettingsGroup name={name} description={description} settings={settings} />
  );
}

/**
 * Renders a group of related settings under a subtle section header.
 * Previously this was a collapsible, but every consumer always opened it
 * by default and never closed it, so the chrome was pure noise.
 */
function SettingsGroup({
  name,
  description,
  settings
}: {
  name: string;
  description?: string;
  settings: IntegrationSetting[];
}) {
  return (
    <div className="w-full border-t border-border pt-4">
      <div className="flex flex-col gap-1 pb-3">
        <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-foreground/70">
          {name}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <VStack spacing={4}>
        {settings.map((setting) => (
          <SettingField key={setting.name} setting={setting} />
        ))}
      </VStack>
    </div>
  );
}

/**
 * An extra tab rendered next to the Settings form (e.g. the accounting
 * Sync Activity inbox). Content is rendered outside the settings
 * ValidatedForm, so tab content can safely contain its own forms.
 */
export type IntegrationFormTab = {
  value: string;
  label: ReactNode;
  /**
   * Render function receiving the shared tab bar, so each tab can render it
   * at the top of its own body card (the white section) instead of the bar
   * living in the gray header. The tab's content component renders `tabs` as
   * the first child of its `DrawerBody`.
   */
  content: (tabs: ReactNode) => ReactNode;
};

interface IntegrationFormProps {
  metadata: Record<string, unknown>;
  installed: boolean;
  onClose: () => void;
  /** Dynamic options to merge into settings (e.g., fetched from external APIs) */
  dynamicOptions?: Record<
    string,
    Array<{ value: string; label: string; description?: string }>
  >;
  /** Extra tabs after the Settings tab; when present the drawer widens and
   * a tab bar renders under the header. */
  tabs?: IntegrationFormTab[];
  /** Initially-selected tab value (defaults to the Settings tab). */
  defaultTab?: string;
}

export function IntegrationForm({
  installed,
  metadata,
  onClose,
  dynamicOptions = {},
  tabs = [],
  defaultTab
}: IntegrationFormProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const isDisabled = !permissions.can("update", "settings");
  const {
    company: { id: companyId }
  } = useUser();
  // Host for filling webhook-URL placeholders in setting help text (client-only).
  const webhookHost = typeof window !== "undefined" ? window.location.host : "";

  const { id: integrationId } = useParams();

  // Controlled tab state seeded from (and following) the ?tab= deep link:
  // links inside tab content (e.g. the QBD checklist's "Open Account
  // Mapping") update the search param, and this effect switches the tab
  // without a remount. Manual tab clicks don't write the URL.
  const [activeTab, setActiveTab] = useState(defaultTab ?? "settings");
  useEffect(() => {
    if (defaultTab) setActiveTab(defaultTab);
  }, [defaultTab]);

  const integration = integrationId
    ? availableIntegrations.find((i) => i.id === integrationId)
    : undefined;

  // Extract connected organisation name from metadata (e.g. Xero tenant
  // name). New credentials keep provider fields under providerMetadata;
  // legacy rows kept tenantName at the top level.
  const credentialsRecord = metadata?.credentials as
    | Record<string, unknown>
    | undefined;
  const connectedOrgName = ((
    credentialsRecord?.providerMetadata as Record<string, unknown> | undefined
  )?.tenantName ?? credentialsRecord?.tenantName) as string | undefined;

  // Group settings by their group property
  // Settings without a group appear first (ungrouped)
  // Also merges dynamic options into settings that have them
  const { ungroupedSettings, groupedSettings, groupNames, groupDescriptions } =
    useMemo(() => {
      if (!integration) {
        return {
          ungroupedSettings: [] as IntegrationSetting[],
          groupedSettings: new Map<string, IntegrationSetting[]>(),
          groupNames: [] as string[],
          groupDescriptions: new Map<string, string | undefined>()
        };
      }

      const ungrouped: IntegrationSetting[] = [];
      const grouped = new Map<string, IntegrationSetting[]>();

      for (const rawSetting of integration.settings) {
        const baseSetting = rawSetting as IntegrationSetting;
        // Fill runtime placeholders (webhook host + company ID) in help text,
        // then merge dynamic options if available for this setting.
        const setting: IntegrationSetting = {
          ...baseSetting,
          description: fillSettingPlaceholders(
            baseSetting.description,
            webhookHost,
            companyId
          ),
          ...(dynamicOptions[baseSetting.name]
            ? { listOptions: dynamicOptions[baseSetting.name] }
            : {})
        };

        if (!setting.group) {
          ungrouped.push(setting);
        } else {
          const existing = grouped.get(setting.group) ?? [];
          grouped.set(setting.group, [...existing, setting]);
        }
      }

      // Build group descriptions map from settingGroups
      const descriptions = new Map<string, string | undefined>();
      const settingGroups =
        (integration as { settingGroups?: IntegrationSettingGroup[] })
          .settingGroups ?? [];
      for (const group of settingGroups) {
        descriptions.set(group.name, group.description);
      }

      return {
        ungroupedSettings: ungrouped,
        groupedSettings: grouped,
        groupNames: [...grouped.keys()],
        groupDescriptions: descriptions
      };
    }, [integration, dynamicOptions, webhookHost, companyId]);

  const initialValues = useMemo(() => {
    if (!integration) return {};
    return integration.settings.reduce(
      (acc, setting) => {
        return {
          ...acc,
          [setting.name]: metadata[setting.name] ?? setting.value
        };
      },
      {} as Record<string, unknown>
    );
  }, [integration, metadata]);

  const integrationActions =
    (integration as { actions?: IntegrationAction[] })?.actions ?? [];

  if (!integrationId) {
    throw new Error("Integration ID is required");
  }

  if (!integration) {
    toast.error(t`Integration not found`);
    return null;
  }

  const hasTabs = tabs.length > 0;

  const headerContent = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-card p-1.5">
          <integration.logo className="h-full w-auto" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Heading size="h3" className="truncate">
              {integration.name}
            </Heading>
            {installed && <Badge variant="green">Installed</Badge>}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary">{integration.category}</Badge>
            <span aria-hidden>•</span>
            <span>
              <Trans>Published by Carbon</Trans>
            </span>
          </div>
        </div>
      </div>
      {installed && connectedOrgName && (
        <div className="text-sm text-muted-foreground">
          <Trans>Connected to</Trans>{" "}
          <span className="font-medium text-foreground">
            {connectedOrgName}
          </span>
        </div>
      )}
    </div>
  );

  // Shared tab bar, rendered at the top of each tab's body card (the white
  // section) rather than in the gray header. Null when there are no tabs.
  const tabBar = hasTabs ? (
    <TabsList className="mb-3 self-start">
      <TabsTrigger value="settings">
        <Trans>Settings</Trans>
      </TabsTrigger>
      {tabs.map((tab) => (
        <TabsTrigger key={tab.value} value={tab.value}>
          {tab.label}
        </TabsTrigger>
      ))}
    </TabsList>
  ) : null;

  const settingsForm = (
    <ValidatedForm
      validator={integration.schema}
      method="post"
      action={path.to.integration(integration.id)}
      defaultValues={initialValues}
      className="flex flex-col h-full"
    >
      {!hasTabs && <DrawerHeader>{headerContent}</DrawerHeader>}
      <DrawerBody>
        {tabBar}
        <ScrollArea
          className={cn(
            "-mx-2 pb-8",
            hasTabs ? "h-[calc(100dvh-320px)]" : "h-[calc(100dvh-240px)]"
          )}
        >
          <VStack spacing={4} className="px-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {integration.description}
            </p>

            {/* @ts-expect-error TS2339 */}
            {integration.setupInstructions && (
              <div className="flex flex-col gap-2">
                <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-foreground/70">
                  <Trans>Setup instructions</Trans>
                </div>
                {/* @ts-expect-error TS2339 */}
                <integration.setupInstructions companyId={companyId} />
              </div>
            )}

            {/* Ungrouped settings appear first */}
            {ungroupedSettings.length > 0 && (
              <VStack spacing={4} className="w-full">
                {ungroupedSettings.map((setting) => (
                  <SettingField key={setting.name} setting={setting} />
                ))}
              </VStack>
            )}

            {/* Grouped settings in flat sections */}
            {groupNames.map((groupName) => (
              <ConditionalSettingsGroup
                key={groupName}
                name={groupName}
                description={groupDescriptions.get(groupName)}
                settings={groupedSettings.get(groupName) ?? []}
              />
            ))}

            {installed && integrationActions.length > 0 && (
              // `has-[button]` collapses the whole section (header included)
              // when every gated action is hidden, so the toggle live-controls
              // visibility without leaving an empty "Actions" header.
              <div className="hidden has-[button]:flex w-full flex-col gap-3 border-t border-border pt-4">
                <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-foreground/70">
                  <Trans>Actions</Trans>
                </div>
                <VStack spacing={2} className="w-full">
                  {integrationActions.map((action) =>
                    action.enabledWhenSetting ? (
                      <GatedIntegrationActionButton
                        key={action.id}
                        action={action}
                        isDisabled={isDisabled}
                      />
                    ) : (
                      <IntegrationActionButton
                        key={action.id}
                        action={action}
                        isDisabled={isDisabled}
                      />
                    )
                  )}
                </VStack>
              </div>
            )}
          </VStack>
        </ScrollArea>
        <div className="mt-2">
          <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
            Carbon Manufacturing Systems does not endorse any third-party
            software.{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              Report integration
            </a>
            .
          </p>
        </div>
      </DrawerBody>
      <DrawerFooter>
        <HStack>
          {integration.settings.length > 0 ? (
            installed ? (
              <Submit isDisabled={isDisabled}>
                <Trans>Update</Trans>
              </Submit>
            ) : (
              <Submit isDisabled={isDisabled}>
                <Trans>Install</Trans>
              </Submit>
            )
          ) : null}

          <Button variant="solid" onClick={onClose}>
            <Trans>Close</Trans>
          </Button>
        </HStack>
      </DrawerFooter>
    </ValidatedForm>
  );

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent size={hasTabs ? "lg" : "md"}>
        {hasTabs ? (
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex h-full min-h-0 flex-col"
          >
            <DrawerHeader>{headerContent}</DrawerHeader>
            {/* Tab bar now lives inside each tab's body card (rendered by the
                content via `tabBar`), so it sits on the white section. */}
            <TabsContent
              forceMount
              value="settings"
              className="min-h-0 flex-1 outline-none data-[state=inactive]:hidden"
            >
              {settingsForm}
            </TabsContent>
            {tabs.map((tab) => (
              <TabsContent
                forceMount
                key={tab.value}
                value={tab.value}
                className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none data-[state=inactive]:hidden"
              >
                {tab.content(tabBar)}
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          settingsForm
        )}
      </DrawerContent>
    </Drawer>
  );
}
