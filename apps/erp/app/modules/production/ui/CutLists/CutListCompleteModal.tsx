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
  NumberField,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import type { CutListLine } from "../../types";

export type AvailableLot = {
  id: string;
  readableId: string | null;
  itemId: string | null;
  quantity: number;
  /** Length attribute when this lot is itself a remnant. */
  length: number | null;
  heatNumber: string | null;
};

type CutListCompleteModalProps = {
  cutListId: string;
  lines: CutListLine[];
  lots: AvailableLot[];
  unitOfDimension: string;
  minRemnantLength: number;
  onClose: () => void;
};

/**
 * The operator's confirmation: how many of each piece actually got cut, which
 * bars were consumed, and what drop went back on the rack. Everything else
 * (per-job consumption, heat genealogy, yield) is derived server-side.
 */
const CutListCompleteModal = ({
  cutListId,
  lines,
  lots,
  unitOfDimension,
  minRemnantLength,
  onClose
}: CutListCompleteModalProps) => {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();

  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      lines.map((line) => [
        line.id!,
        Math.max((line.quantity ?? 0) - (line.quantityCut ?? 0), 0)
      ])
    )
  );
  const [consumed, setConsumed] = useState<Record<string, number>>({});
  const [remnants, setRemnants] = useState<Record<string, number>>({});

  const isSubmitting = fetcher.state !== "idle";

  const { validRemnants, scrapDrops } = useMemo(() => {
    // A drop shorter than the threshold isn't worth racking — it posts as
    // scrap instead of becoming a lot nobody will ever pick.
    const valid: { fromTrackedEntityId: string; length: number }[] = [];
    const scrap: { fromTrackedEntityId: string; length: number }[] = [];
    for (const [entityId, length] of Object.entries(remnants)) {
      if (!length || length <= 0) continue;
      if (length >= minRemnantLength && minRemnantLength > 0) {
        valid.push({ fromTrackedEntityId: entityId, length });
      } else if (minRemnantLength === 0) {
        valid.push({ fromTrackedEntityId: entityId, length });
      } else {
        scrap.push({ fromTrackedEntityId: entityId, length });
      }
    }
    return { validRemnants: valid, scrapDrops: scrap };
  }, [remnants, minRemnantLength]);

  const onSubmit = () => {
    const payload = {
      lines: lines.map((line) => ({
        cutListLineId: line.id!,
        quantityCut: quantities[line.id!] ?? 0
      })),
      consumed: Object.entries(consumed)
        .filter(([, qty]) => qty > 0)
        .map(([trackedEntityId, quantityConsumed]) => ({
          trackedEntityId,
          quantityConsumed
        })),
      untrackedConsumed: [],
      remnants: validRemnants,
      scrap: scrapDrops.map((drop) => ({
        fromTrackedEntityId: drop.fromTrackedEntityId,
        quantity: drop.length
      }))
    };

    fetcher.submit(
      { payload: JSON.stringify(payload) },
      { method: "post", action: path.to.cutListComplete(cutListId) }
    );
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xlarge">
        <ModalHeader>
          <ModalTitle>{t`Complete cut list`}</ModalTitle>
          <ModalDescription>
            {t`Record what was actually cut and what drop goes back to stock.`}
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <div className="w-full">
              <h3 className="text-sm font-medium mb-2">{t`Pieces cut`}</h3>
              <Table>
                <Thead>
                  <Tr>
                    <Th>{t`Material`}</Th>
                    <Th className="text-right">{t`Length`}</Th>
                    <Th className="text-right">{t`Remaining`}</Th>
                    <Th className="text-right w-32">{t`Cut now`}</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {lines.map((line) => {
                    const item = line.item as {
                      readableIdWithRevision?: string | null;
                    } | null;
                    const remaining = Math.max(
                      (line.quantity ?? 0) - (line.quantityCut ?? 0),
                      0
                    );
                    return (
                      <Tr key={line.id}>
                        <Td>{item?.readableIdWithRevision ?? ""}</Td>
                        <Td className="text-right tabular-nums">
                          {line.pieceLength} {unitOfDimension}
                        </Td>
                        <Td className="text-right tabular-nums">{remaining}</Td>
                        <Td>
                          <NumberField
                            value={quantities[line.id!] ?? 0}
                            minValue={0}
                            maxValue={remaining}
                            onChange={(value) =>
                              setQuantities((q) => ({
                                ...q,
                                [line.id!]: value
                              }))
                            }
                          >
                            <NumberInputGroup className="relative">
                              <NumberInput size="sm" />
                              <NumberInputStepper />
                            </NumberInputGroup>
                          </NumberField>
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            </div>

            <div className="w-full">
              <h3 className="text-sm font-medium mb-2">{t`Stock consumed`}</h3>
              {lots.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t`No batch-tracked stock on hand for these materials. Remnants need batch tracking to keep their lot identity.`}
                </p>
              ) : (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>{t`Lot`}</Th>
                      <Th>{t`Heat`}</Th>
                      <Th className="text-right">{t`On hand`}</Th>
                      <Th className="text-right w-32">{t`Consume`}</Th>
                      <Th className="text-right w-32">{t`Drop length`}</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {lots.map((lot) => (
                      <Tr key={lot.id}>
                        <Td>
                          {lot.readableId ?? lot.id}
                          {lot.length ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {t`remnant`} {lot.length} {unitOfDimension}
                            </span>
                          ) : null}
                        </Td>
                        <Td className="text-muted-foreground">
                          {lot.heatNumber ?? "—"}
                        </Td>
                        <Td className="text-right tabular-nums">
                          {lot.quantity}
                        </Td>
                        <Td>
                          <NumberField
                            value={consumed[lot.id] ?? 0}
                            minValue={0}
                            maxValue={lot.quantity}
                            onChange={(value) =>
                              setConsumed((c) => ({ ...c, [lot.id]: value }))
                            }
                          >
                            <NumberInputGroup className="relative">
                              <NumberInput size="sm" />
                              <NumberInputStepper />
                            </NumberInputGroup>
                          </NumberField>
                        </Td>
                        <Td>
                          <NumberField
                            value={remnants[lot.id] ?? 0}
                            minValue={0}
                            onChange={(value) =>
                              setRemnants((r) => ({ ...r, [lot.id]: value }))
                            }
                          >
                            <NumberInputGroup className="relative">
                              <NumberInput size="sm" />
                              <NumberInputStepper />
                            </NumberInputGroup>
                          </NumberField>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              )}
              {scrapDrops.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  {t`${scrapDrops.length} drop(s) below the ${minRemnantLength} ${unitOfDimension} minimum will post as scrap.`}
                </p>
              )}
            </div>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button
              variant="primary"
              onClick={onSubmit}
              isLoading={isSubmitting}
              isDisabled={isSubmitting}
            >
              {t`Complete`}
            </Button>
            <Button variant="solid" onClick={onClose}>
              {t`Cancel`}
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default CutListCompleteModal;
