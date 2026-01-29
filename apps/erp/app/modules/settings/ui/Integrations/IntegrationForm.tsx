import type {
  IntegrationAction,
  IntegrationSetting,
  IntegrationSettingOption
} from "@carbon/ee";
import { integrations as availableIntegrations } from "@carbon/ee";
import {
  // biome-ignore lint/suspicious/noShadowRestrictedNames: suppressed due to migration
  Array,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: suppressed due to migration
  Boolean,
  Input,
  Select,
  Submit,
  ValidatedForm
} from "@carbon/form";
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  Heading,
  HStack,
  ScrollArea,
  toast,
  VStack
} from "@carbon/react";
import { SUPPORT_EMAIL } from "@carbon/utils";
import { useCallback, useMemo, useState } from "react";
import { LuChevronDown } from "react-icons/lu";
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

/**
 * Helper to normalize option to consistent format
 */
function normalizeOption(option: IntegrationSettingOption): {
  value: string;
  label: string;
  description?: string;
} {
  if (typeof option === "string") {
    return { value: option, label: option };
  }
  return option;
}

/**
 * Renders a single setting field based on its type
 */
function SettingField({ setting }: { setting: IntegrationSetting }) {
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
            <p className="text-xs text-muted-foreground mt-1">
              {setting.description}
            </p>
          )}
        </div>
      );

    case "switch":
      return (
        <div className="flex items-center justify-between gap-4 w-full py-2">
          <div className="flex flex-col flex-1">
            <span className="text-sm font-medium">{setting.label}</span>
            {setting.description && (
              <span className="text-xs text-muted-foreground">
                {setting.description}
              </span>
            )}
          </div>
          <div className="shrink-0">
            <Boolean name={setting.name} />
          </div>
        </div>
      );

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
          <Array name={setting.name} label={setting.label} />
          {setting.description && (
            <p className="text-xs text-muted-foreground mt-1">
              {setting.description}
            </p>
          )}
        </div>
      );

    case "options": {
      const options =
        setting.listOptions?.map((option) => {
          const normalized = normalizeOption(option);
          let icon: JSX.Element | null = null;

          // Legacy icon support for specific field names
          if (setting.name === "methodType") {
            // @ts-ignore
            icon = <MethodIcon type={normalized.value} />;
          } else if (setting.name === "trackingType") {
            // @ts-ignore
            icon = <TrackingTypeIcon type={normalized.value} />;
          }

          // Build a simpler label that works well with Radix Select
          const label = (
            <span className="flex items-center gap-2">
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
        }) ?? [];

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
 * Renders a collapsible group of settings
 */
function SettingsGroup({
  name,
  settings
}: {
  name: string;
  settings: IntegrationSetting[];
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 group">
        <Heading size="h4" className="text-left">
          {name}
        </Heading>
        <LuChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <VStack spacing={4} className="pt-2">
          {settings.map((setting) => (
            <SettingField key={setting.name} setting={setting} />
          ))}
        </VStack>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface IntegrationFormProps {
  metadata: Record<string, unknown>;
  installed: boolean;
  onClose: () => void;
}

export function IntegrationForm({
  installed,
  metadata,
  onClose
}: IntegrationFormProps) {
  const permissions = usePermissions();
  const isDisabled = !permissions.can("update", "settings");
  const {
    company: { id: companyId }
  } = useUser();

  const { id: integrationId } = useParams();

  const integration = integrationId
    ? availableIntegrations.find((i) => i.id === integrationId)
    : undefined;

  // Extract connected organisation name from metadata (e.g. Xero tenant name)
  const connectedOrgName = (metadata?.credentials as Record<string, unknown>)
    ?.tenantName as string | undefined;

  // Group settings by their group property
  // Settings without a group appear first (ungrouped)
  const { ungroupedSettings, groupedSettings, groupNames } = useMemo(() => {
    if (!integration) {
      return {
        ungroupedSettings: [] as IntegrationSetting[],
        groupedSettings: new Map<string, IntegrationSetting[]>(),
        groupNames: [] as string[]
      };
    }

    const ungrouped: IntegrationSetting[] = [];
    const grouped = new Map<string, IntegrationSetting[]>();

    for (const setting of integration.settings) {
      if (!setting.group) {
        ungrouped.push(setting);
      } else {
        const existing = grouped.get(setting.group) ?? [];
        grouped.set(setting.group, [...existing, setting]);
      }
    }

    return {
      ungroupedSettings: ungrouped,
      groupedSettings: grouped,
      groupNames: [...grouped.keys()]
    };
  }, [integration]);

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

  if (!integrationId) {
    throw new Error("Integration ID is required");
  }

  if (!integration) {
    toast.error("Integration not found");
    return null;
  }

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={integration.schema}
          method="post"
          action={path.to.integration(integration.id)}
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <VStack spacing={2}>
              <integration.logo className="h-10 w-auto" />
              <div>
                <div className="flex items-center space-x-2">
                  <Heading size="h3">{integration.name}</Heading>

                  {installed && <Badge variant="green">Installed</Badge>}

                  <span className="text-xs text-[#878787] text-right">
                    <Badge variant="secondary">{integration.category}</Badge> •
                    Published by Carbon
                  </span>
                </div>

                {installed && connectedOrgName && (
                  <div className="text-sm text-muted-foreground">
                    Connected to{" "}
                    <span className="font-medium text-foreground">
                      {connectedOrgName}
                    </span>
                  </div>
                )}
              </div>
            </VStack>
          </DrawerHeader>
          <DrawerBody>
            <ScrollArea className="h-[calc(100dvh-240px)] -mx-2 pb-8">
              <VStack spacing={4} className="px-2">
                <Heading size="h3">How it works</Heading>
                <div className="text-sm text-muted-foreground">
                  {integration.description}
                </div>

                {integration.setupInstructions && (
                  <>
                    <Heading size="h3">Setup Instructions</Heading>
                    <integration.setupInstructions companyId={companyId} />
                  </>
                )}

                {/* Ungrouped settings appear first */}
                {ungroupedSettings.length > 0 && (
                  <VStack spacing={4} className="w-full">
                    {ungroupedSettings.map((setting) => (
                      <SettingField key={setting.name} setting={setting} />
                    ))}
                  </VStack>
                )}

                {/* Grouped settings in collapsible sections */}
                {groupNames.map((groupName) => (
                  <SettingsGroup
                    key={groupName}
                    name={groupName}
                    settings={groupedSettings.get(groupName) ?? []}
                  />
                ))}

                {installed &&
                  integration.actions &&
                  integration.actions.length > 0 && (
                    <>
                      <Heading size="h3">Actions</Heading>
                      <VStack spacing={2} className="w-full">
                        {integration.actions.map((action) => (
                          <IntegrationActionButton
                            key={action.id}
                            action={action}
                            isDisabled={isDisabled}
                          />
                        ))}
                      </VStack>
                    </>
                  )}
              </VStack>
            </ScrollArea>
            <p className="text-sm text-muted-foreground">
              Carbon Manufacturing Systems does not endorse any third-party
              software. Report any concerns about app content or behavior.
            </p>

            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-sm text-red-500"
            >
              Report integration
            </a>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              {integration.settings.length > 0 ? (
                installed ? (
                  <Submit isDisabled={isDisabled}>Update</Submit>
                ) : (
                  <Submit isDisabled={isDisabled}>Install</Submit>
                )
              ) : null}

              <Button variant="solid" onClick={onClose}>
                Close
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
}
