// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { Button, useDisclosure, useMount } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useCallback, useRef, useState } from "react";
import { useUser } from "~/hooks";
import {
  type ConfigurationParameter,
  type ConfigurationParameterGroup,
  getConfigurationParameters
} from "~/modules/items";
import { ConfiguratorModal, type ConfiguratorValues } from "./ConfiguratorForm";

type ItemConfigurationParameters = {
  parameters: ConfigurationParameter[];
  groups: ConfigurationParameterGroup[];
};

/**
 * The configurator of a document line: the line item's configuration
 * parameters (null when the item needs no configuration) and the values
 * chosen for them.
 */
export function useItemConfiguration(initial: {
  itemId?: string;
  configuration?: ConfiguratorValues | null;
}) {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const disclosure = useDisclosure();
  const [parameters, setParameters] =
    useState<ItemConfigurationParameters | null>(null);
  const [configuration, setConfiguration] = useState<ConfiguratorValues | null>(
    initial.configuration ?? null
  );
  // The item the latest load is for: a slower response for an item picked
  // earlier must not overwrite it.
  const requestedItemId = useRef<string | null>(null);

  const load = useCallback(
    async (itemId: string) => {
      requestedItemId.current = itemId;
      if (!carbon || !company.id) return;
      const replenishment = await carbon
        .from("itemReplenishment")
        .select("requiresConfiguration")
        .eq("itemId", itemId)
        .eq("companyId", company.id)
        .maybeSingle();
      const result = replenishment.data?.requiresConfiguration
        ? await getConfigurationParameters(carbon, itemId, company.id)
        : null;
      if (requestedItemId.current === itemId) setParameters(result);
    },
    [carbon, company.id]
  );

  useMount(() => {
    if (initial.itemId) load(initial.itemId);
  });

  // A configuration belongs to one item's parameters.
  const changeItem = (itemId: string) => {
    setConfiguration(null);
    load(itemId);
  };

  return {
    parameters,
    configuration,
    setConfiguration,
    changeItem,
    disclosure
  };
}

/**
 * Configure / Reconfigure for a line whose item requires configuration, with
 * its configurator modal. Renders nothing for any other item.
 */
export function ItemConfigureButton({
  configurator,
  isDisabled,
  onConfigured
}: {
  configurator: ReturnType<typeof useItemConfiguration>;
  isDisabled: boolean;
  onConfigured: (values: ConfiguratorValues) => void;
}) {
  const { parameters, configuration, setConfiguration, disclosure } =
    configurator;
  if (!parameters) return null;

  return (
    <>
      <Button
        variant={configuration ? "secondary" : "primary"}
        type="button"
        isDisabled={isDisabled}
        onClick={disclosure.onOpen}
      >
        {configuration ? <Trans>Reconfigure</Trans> : <Trans>Configure</Trans>}
      </Button>
      {disclosure.isOpen && (
        <ConfiguratorModal
          open
          initialValues={configuration ?? {}}
          groups={parameters.groups}
          parameters={parameters.parameters}
          onClose={disclosure.onClose}
          onSubmit={(values) => {
            setConfiguration(values);
            disclosure.onClose();
            onConfigured(values);
          }}
        />
      )}
    </>
  );
}
