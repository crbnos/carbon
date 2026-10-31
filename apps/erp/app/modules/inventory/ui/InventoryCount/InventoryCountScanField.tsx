// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import { HStack, IconButton, Input, toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { LuScanBarcode } from "react-icons/lu";
import { StorageUnit } from "~/components/Form";
import { inventoryCountScanValidator } from "~/modules/inventory/inventory.models";
import type { InventoryCountUnitOutcome } from "~/modules/inventory/inventory.service";
import type { action as scanAction } from "~/routes/x+/inventory-count+/$id.scan";
import { path } from "~/utils/path";
import InventoryCountUnitForm, {
  type InventoryCountUnitPrompt
} from "./InventoryCountUnitForm";

type InventoryCountScanFieldProps = {
  inventoryCountId: string;
  locationId: string;
};

// A storage unit and a code field in the count table's toolbar. Pick the bin,
// then scan serial or batch numbers into it; a keyboard-wedge scanner types
// the code and presses Enter. The bin stays picked between scans.
const InventoryCountScanField = ({
  inventoryCountId,
  locationId
}: InventoryCountScanFieldProps) => {
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
          toast.success(t`${code} counted`);
          setCode("");
          break;
        case "alreadyCounted":
          toast.info(t`${code} is already counted`);
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
      >
        {/* Held in state: the form resets after each scan, and the counter
            keeps scanning into the same bin. */}
        <input type="hidden" name="storageUnitId" value={storageUnitId ?? ""} />
        <HStack spacing={1}>
          <div className="w-40">
            <StorageUnit
              placeholder={t`No storage unit`}
              locationId={locationId}
              value={storageUnitId ?? undefined}
              allowCreate={false}
              onChange={(unit) => {
                setStorageUnitId(unit?.id ?? null);
                focusCode();
              }}
            />
          </div>
          <Input
            ref={codeRef}
            name="code"
            size="sm"
            className="w-52"
            aria-label={t`Scan a serial, batch or item number`}
            placeholder={t`Scan serial or batch…`}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
          />
          <IconButton
            type="submit"
            size="sm"
            variant="secondary"
            aria-label={t`Record scan`}
            icon={<LuScanBarcode />}
            isDisabled={!code.trim()}
            isLoading={fetcher.state !== "idle"}
          />
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
          onRecorded={() => {
            setPrompt(null);
            setCode("");
            focusCode();
          }}
        />
      )}
    </>
  );
};

export default InventoryCountScanField;
