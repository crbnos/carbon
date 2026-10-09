// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  NumberField,
  NumberInput,
  Table,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP, round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "react-router";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePermissions,
  useUser
} from "~/hooks";
import type { CutoverFixedAsset } from "~/modules/accounting/accounting.server";
import { path } from "~/utils/path";
import { activationStepPath, useActivationRouteData } from "./ActivationSteps";

/**
 * Per asset acquired before the cutover, its cost and its accumulated
 * depreciation at the cutover. No depreciation run happens before the
 * cutover, so the accumulated depreciation is entered here.
 */
export default function FixedAssetDepreciationTable({
  assets
}: {
  assets: CutoverFixedAsset[];
}) {
  const formatter = useCurrencyFormatter();
  const totalCost = round(assets.reduce((sum, asset) => sum + asset.cost, 0));
  const totalDepreciation = round(
    assets.reduce((sum, asset) => sum + asset.accumulatedDepreciation, 0)
  );

  return (
    <Table>
      <Thead>
        <Tr>
          <Th>
            <Trans>Asset</Trans>
          </Th>
          <Th>
            <Trans>Status</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Cost</Trans>
          </Th>
          <Th className="w-48 text-right">
            <Trans>Accumulated Depreciation</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Net Book Value</Trans>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {assets.length === 0 ? (
          <Tr>
            <Td colSpan={5} className="text-center text-muted-foreground">
              <Trans>
                No fixed asset was acquired before the cutover date.
              </Trans>
            </Td>
          </Tr>
        ) : (
          assets.map((asset) => (
            <FixedAssetDepreciationRow key={asset.id} asset={asset} />
          ))
        )}
      </Tbody>
      <Tfoot>
        <Tr>
          <Th colSpan={2}>
            <Trans>Total</Trans>
          </Th>
          <Th className="text-right tabular-nums">
            {formatter.format(totalCost)}
          </Th>
          <Th className="text-right tabular-nums">
            {formatter.format(totalDepreciation)}
          </Th>
          <Th className="text-right tabular-nums">
            {formatter.format(round(totalCost - totalDepreciation))}
          </Th>
        </Tr>
      </Tfoot>
    </Table>
  );
}

function FixedAssetDepreciationRow({ asset }: { asset: CutoverFixedAsset }) {
  const { t } = useLingui();
  const formatter = useCurrencyFormatter();
  const { company } = useUser();
  const currencyDecimals = useCurrencyDecimals(company.baseCurrencyCode);
  const permissions = usePermissions();
  const cutoverDate = useActivationRouteData()?.cutoverDate ?? "";
  // Errors arrive as a flash toast from the route action.
  const save = useAction();

  return (
    <Tr>
      <Td>
        <div className="flex flex-col">
          <Link
            to={path.to.fixedAsset(asset.id)}
            className="font-medium text-primary hover:underline"
          >
            {asset.fixedAssetId}
          </Link>
          <span className="text-xs text-muted-foreground">{asset.name}</span>
        </div>
      </Td>
      <Td>{asset.status}</Td>
      <Td className="text-right tabular-nums">
        {formatter.format(asset.cost)}
      </Td>
      <Td className="text-right">
        <NumberField
          // A saved value reloads the row; the new value remounts the input.
          key={`${asset.id}:${asset.accumulatedDepreciation}`}
          aria-label={t`Accumulated depreciation for ${asset.fixedAssetId}`}
          defaultValue={asset.accumulatedDepreciation}
          minValue={0}
          maxValue={asset.cost}
          step={INPUT_STEP.money(currencyDecimals)}
          formatOptions={INPUT_FORMAT.money(
            company.baseCurrencyCode,
            currencyDecimals
          )}
          // A disposal after the cutover cleared what it found.
          isDisabled={
            !permissions.can("update", "accounting") ||
            save.isPending ||
            asset.status === "Disposed"
          }
          onChange={(value) => {
            if (
              !Number.isFinite(value) ||
              value === asset.accumulatedDepreciation
            ) {
              return;
            }
            save.submit(
              {
                intent: "save-asset",
                fixedAssetId: asset.id,
                accumulatedDepreciation: String(value)
              },
              {
                method: "post",
                action: activationStepPath("fixed-assets", cutoverDate)
              }
            );
          }}
        >
          <NumberInput
            size="sm"
            className="h-7 text-right font-mono tabular-nums"
          />
        </NumberField>
      </Td>
      <Td className="text-right tabular-nums">
        {formatter.format(round(asset.cost - asset.accumulatedDepreciation))}
      </Td>
    </Tr>
  );
}
