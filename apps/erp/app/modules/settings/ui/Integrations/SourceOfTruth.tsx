import { ChoiceCardGroup, Submit, ValidatedForm } from "@carbon/form";
import { DrawerBody, DrawerFooter, HStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useState } from "react";
import { usePermissions } from "~/hooks";
import { entitySyncSettingsValidator } from "~/modules/settings/settings.models";

/**
 * Local structural mirror of @carbon/ee/accounting's EntitySyncEntry.
 * Deliberately NOT imported (even type-only) — see the TS2589
 * instantiation-depth note in PostingSyncSettings.tsx / ./index.ts. The
 * route passes the resolved entries, so drift fails typecheck at that call
 * site.
 */
export type SourceOfTruthOwner = "carbon" | "accounting";

export type SourceOfTruthEntry = {
  entityType: string;
  label: string;
  owner: SourceOfTruthOwner;
  /** False when the provider's capability forcing overrides any stored owner. */
  configurable: boolean;
  /** Human explanation of the forced owner. Present only when !configurable. */
  note?: string;
};

type SourceOfTruthProps = {
  /** Shared tab bar, rendered at the top of this tab's body card. */
  tabs?: ReactNode;
  /** Display name of the connected provider (e.g. "Xero"), for option/copy labels. */
  providerName: string;
  entities: SourceOfTruthEntry[];
};

/** Forced (non-configurable) entities render a disabled picker that can't change. */
const noop = () => undefined;

export function SourceOfTruth({
  tabs,
  providerName,
  entities
}: SourceOfTruthProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "settings");

  const configurable = entities.filter((entity) => entity.configurable);

  const [ownerState, setOwnerState] = useState<
    Record<string, SourceOfTruthOwner>
  >(() =>
    Object.fromEntries(
      configurable.map((entity) => [entity.entityType, entity.owner])
    )
  );

  return (
    <ValidatedForm
      validator={entitySyncSettingsValidator}
      method="post"
      defaultValues={{ intent: "update-entity-sync" }}
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      <input type="hidden" name="intent" value="update-entity-sync" />
      {configurable.map((entity) => (
        <input
          key={entity.entityType}
          type="hidden"
          name="entityOwners"
          value={`${entity.entityType}|${
            ownerState[entity.entityType] ?? entity.owner
          }`}
        />
      ))}
      <DrawerBody className="gap-6">
        {tabs}
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-foreground/70">
            <Trans>Source of truth</Trans>
          </span>
          <p className="text-xs text-muted-foreground">
            <Trans>
              Which system's data wins when both Carbon and {providerName} have
              changed the same record. Entries {providerName} fixes by its own
              capabilities are shown but can't be changed.
            </Trans>
          </p>
        </div>

        <div className="flex w-full flex-col gap-6">
          {entities.map((entity) => (
            <div key={entity.entityType} className="w-full">
              <div className="flex flex-col gap-0.5 pb-2">
                <div className="text-sm font-medium text-foreground">
                  {entity.label}
                </div>
              </div>
              <ChoiceCardGroup
                value={
                  entity.configurable
                    ? (ownerState[entity.entityType] ?? entity.owner)
                    : entity.owner
                }
                onChange={
                  entity.configurable
                    ? (next) =>
                        setOwnerState((current) => ({
                          ...current,
                          [entity.entityType]: next
                        }))
                    : noop
                }
                options={[
                  {
                    value: "accounting",
                    title: providerName,
                    description: t`${providerName} data overwrites Carbon data`,
                    disabled: !entity.configurable
                  },
                  {
                    value: "carbon",
                    title: t`Carbon`,
                    description: t`Carbon data overwrites ${providerName} data`,
                    disabled: !entity.configurable
                  }
                ]}
              />
            </div>
          ))}
        </div>
      </DrawerBody>
      <DrawerFooter>
        <HStack>
          <Submit isDisabled={!canUpdate || configurable.length === 0}>
            <Trans>Save</Trans>
          </Submit>
        </HStack>
      </DrawerFooter>
    </ValidatedForm>
  );
}
