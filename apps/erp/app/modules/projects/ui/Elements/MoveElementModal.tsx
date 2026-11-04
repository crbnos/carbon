// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Button,
  Combobox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import type { ProjectElementType } from "../../projects.models";
import {
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import { useElementRoutes } from "./ElementRoutes";

/** Moves an element under another parent, or to the top level. */
const TOP_LEVEL = "__top__";

export function MoveElementModal({
  projectId,
  element,
  elements,
  onClose
}: {
  projectId: string;
  element: { id: string; readableId: string; parentId: string | null };
  elements: {
    id: string;
    readableId: string;
    name: string;
    type: ProjectElementType;
    parentId: string | null;
  }[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const changeRequestId = useActiveChangeRequestId();
  const routes = useElementRoutes(projectId);
  const [target, setTarget] = useState<string>(element.parentId ?? TOP_LEVEL);
  const fetcher = useAction<{ success?: boolean }>({
    onSuccess: () => onClose()
  });

  // The element itself and its descendants cannot be its new parent.
  const options = useMemo(() => {
    const childrenOf = new Map<string, string[]>();
    for (const e of elements) {
      if (!e.parentId) continue;
      childrenOf.set(e.parentId, [...(childrenOf.get(e.parentId) ?? []), e.id]);
    }
    const excluded = new Set<string>();
    const stack = [element.id];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (excluded.has(id)) continue;
      excluded.add(id);
      stack.push(...(childrenOf.get(id) ?? []));
    }
    return [
      { value: TOP_LEVEL, label: t`Top level` },
      ...elements
        .filter((e) => !excluded.has(e.id) && e.type !== "Parameter")
        .map((e) => ({
          value: e.id,
          label: `${e.readableId} ${e.name}`,
          keywords: `${e.readableId} ${e.name}`
        }))
    ];
  }, [elements, element.id, t]);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Move {element.readableId}</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <Combobox
            asButton
            value={target}
            options={options}
            onChange={(value) => setTarget(value || TOP_LEVEL)}
            placeholder={t`Choose the new parent`}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            isLoading={fetcher.isPending}
            isDisabled={
              fetcher.isPending || target === (element.parentId ?? TOP_LEVEL)
            }
            onClick={() =>
              fetcher.submit(
                {
                  intent: "move",
                  elementId: element.id,
                  parentId: target === TOP_LEVEL ? "" : target
                },
                {
                  method: "post",
                  action: withChangeRequest(routes.move, changeRequestId)
                }
              )
            }
          >
            <Trans>Move</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
