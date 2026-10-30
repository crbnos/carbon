// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import { HStack, toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { InputControlled, StorageUnit, Submit } from "~/components/Form";
import { inventoryCountScanValidator } from "~/modules/inventory/inventory.models";
import type { InventoryCountUnitOutcome } from "~/modules/inventory/inventory.service";
import type { action as scanAction } from "~/routes/x+/inventory-count+/$id.scan";
import { path } from "~/utils/path";
import InventoryCountUnitForm, {
  type InventoryCountUnitPrompt
} from "./InventoryCountUnitForm";

type InventoryCountScanBarProps = {
  inventoryCountId: string;
  locationId: string;
  // The group a unit landed in, so the count sheet can open it.
  onRecorded: (groupId: string) => void;
};

// Pick a storage unit, then scan serial or batch numbers into it. A
// keyboard-wedge scanner types the code and presses Enter.
const InventoryCountScanBar = ({
  inventoryCountId,
  locationId,
  onRecorded
}: InventoryCountScanBarProps) => {
  const { t } = useLingui();
  const [storageUnitId, setStorageUnitId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [prompt, setPrompt] = useState<InventoryCountUnitPrompt | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const focusCode = () => {
    requestAnimationFrame(() => codeRef.current?.focus());
  };

  const fetcher = useAction<typeof scanAction>({
    onSuccess: (result) => {
      if (!("data" in result) || !result.data) return;
      const outcome = result.data as InventoryCountUnitOutcome;
      switch (outcome.outcome) {
        case "counted":
        case "added":
          onRecorded(outcome.groupId);
          setCode("");
          break;
        case "alreadyCounted":
          toast.info(t`Already counted`);
          onRecorded(outcome.groupId);
          setCode("");
          break;
        case "wrongStorageUnit":
          toast.error(t`That storage unit is not at this count's location`);
          break;
        case "needsUnitNumber":
          toast.error(t`Scan the serial or batch number, not the item`);
          setCode("");
          break;
        case "ambiguous":
          setPrompt({ code, storageUnitId, itemIds: outcome.itemIds });
          break;
        case "needsQuantity":
          setPrompt({
            code,
            storageUnitId,
            itemId: outcome.itemId,
            askQuantity: true
          });
          break;
        case "unknown":
          setPrompt({ code, storageUnitId });
          break;
      }
      focusCode();
    }
  });

  return (
    <>
      <ValidatedForm
        validator={inventoryCountScanValidator}
        method="post"
        action={path.to.inventoryCountScan(inventoryCountId)}
        fetcher={fetcher}
        className="w-full"
      >
        <HStack spacing={2} className="w-full items-end px-4 py-2">
          <div className="w-64 shrink-0">
            <StorageUnit
              name="storageUnitId"
              label={t`Storage Unit`}
              locationId={locationId}
              value={storageUnitId ?? undefined}
              allowCreate={false}
              onChange={(unit) => {
                setStorageUnitId(unit?.id ?? null);
                focusCode();
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <InputControlled
              ref={codeRef}
              name="code"
              label={t`Scan serial, batch or item`}
              value={code}
              onChange={setCode}
              autoComplete="off"
              autoFocus
            />
          </div>
          <Submit isDisabled={!code.trim()}>{t`Record`}</Submit>
        </HStack>
      </ValidatedForm>
      {prompt && (
        <InventoryCountUnitForm
          inventoryCountId={inventoryCountId}
          prompt={prompt}
          onClose={() => {
            setPrompt(null);
            focusCode();
          }}
          onRecorded={(groupId) => {
            setPrompt(null);
            setCode("");
            onRecorded(groupId);
            focusCode();
          }}
        />
      )}
    </>
  );
};

export default InventoryCountScanBar;
