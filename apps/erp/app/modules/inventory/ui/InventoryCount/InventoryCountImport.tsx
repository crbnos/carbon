// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { InventoryCountCsvError } from "~/modules/inventory/inventory.utils";
import { INVENTORY_COUNT_CSV_COLUMNS } from "~/modules/inventory/inventory.utils";
import type { action as importAction } from "~/routes/x+/inventory-count+/$id.import";
import { path } from "~/utils/path";

type InventoryCountImportProps = {
  inventoryCountId: string;
  open?: boolean;
  onClose: () => void;
};

// Upload a count results file. A file with any error writes nothing and
// lists each error with its line.
const InventoryCountImport = ({
  open = true,
  onClose,
  ...props
}: InventoryCountImportProps) => {
  return (
    <Modal open={open} onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <InventoryCountImportBody onClose={onClose} {...props} />
      </ModalContent>
    </Modal>
  );
};

const InventoryCountImportBody = ({
  inventoryCountId,
  onClose
}: Omit<InventoryCountImportProps, "open">) => {
  const { t } = useLingui();
  const fetcher = useAction<typeof importAction>({
    onSuccess: (result) => {
      if (!("data" in result) || !result.data) return;
      if ("errors" in result.data) return;
      const { counted, added, removed } = result.data;
      toast.success(
        t`Imported: ${counted} line(s) counted, ${added} added, ${removed} removed`
      );
      onClose();
    }
  });
  const result = fetcher.data;
  const errors: InventoryCountCsvError[] =
    result && "data" in result && result.data && "errors" in result.data
      ? result.data.errors
      : [];

  return (
    <fetcher.Form
      method="post"
      encType="multipart/form-data"
      action={path.to.inventoryCountImport(inventoryCountId)}
    >
      <ModalHeader>
        <ModalTitle>{t`Import Count Results`}</ModalTitle>
        <ModalDescription>
          {t`Columns: ${INVENTORY_COUNT_CSV_COLUMNS.join(", ")}. Each item and storage unit in the file is a full count: units it leaves out are Missing.`}
        </ModalDescription>
      </ModalHeader>
      <ModalBody>
        <VStack spacing={4}>
          <Button variant="secondary" asChild>
            <a href={path.to.api.inventoryCountCsv(inventoryCountId)}>
              {t`Download the count as a file to fill in`}
            </a>
          </Button>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="text-sm"
          />
          {errors.length > 0 && (
            <div className="max-h-64 w-full overflow-y-auto rounded-md border border-destructive/40 p-3 text-sm">
              <p className="mb-2 font-medium text-destructive">
                {t`Nothing was imported. Fix these lines:`}
              </p>
              <ul className="flex flex-col gap-1">
                {errors.map((error) => (
                  <li key={`${error.line}-${error.message}`}>
                    <span className="tabular-nums text-muted-foreground">
                      {t`Line ${error.line}`}
                    </span>
                    {" · "}
                    {error.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </VStack>
      </ModalBody>
      <ModalFooter>
        <HStack>
          <Button variant="secondary" onClick={onClose}>
            {t`Cancel`}
          </Button>
          <Button type="submit" isLoading={fetcher.state !== "idle"}>
            {t`Import`}
          </Button>
        </HStack>
      </ModalFooter>
    </fetcher.Form>
  );
};

export default InventoryCountImport;
