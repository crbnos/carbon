// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { useState } from "react";
import { useUser } from "./useUser";

export function useNextItemId(
  table: "Part" | "Service" | "Tool" | "Material" | "Consumable"
) {
  const { company } = useUser();
  const { carbon } = useCarbon();
  const [loading, setLoading] = useState<boolean>(false);
  const [id, setId] = useState<string>("");

  const onIdChange = async (newItemId: string) => {
    if (newItemId.endsWith("...") && carbon) {
      setLoading(true);

      const prefix = newItemId.slice(0, -3);

      if (prefix) {
        try {
          const nextIdRpc = await carbon?.rpc("get_next_prefixed_sequence", {
            company_id: company.id,
            item_type: table,
            prefix
          });

          if (nextIdRpc.data) {
            const sequence = nextIdRpc.data.slice(prefix.length);
            const currentSequence = parseInt(sequence);
            const nextSequence = currentSequence + 1;
            const nextId = `${prefix}${nextSequence
              .toString()
              .padStart(
                sequence.length -
                  (nextIdRpc.data.split(`${currentSequence}`)?.[1].length ?? 0),
                "0"
              )}`;
            setId(nextId);
          } else {
            setId(`${prefix}${(1).toString().padStart(9, "0")}`);
          }
          // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
        } catch {
        } finally {
          setLoading(false);
        }
      } else {
        try {
          const nextIdRpc = await carbon?.rpc("get_next_numeric_sequence", {
            company_id: company.id,
            item_type: table
          });

          if (nextIdRpc.data) {
            const sequence = nextIdRpc.data.slice(prefix.length);
            const currentSequence = parseInt(sequence);
            const nextSequence = currentSequence + 1;
            const nextId = `${prefix}${nextSequence
              .toString()
              .padStart(
                sequence.length -
                  (nextIdRpc.data.split(`${currentSequence}`)?.[1].length ?? 0),
                "0"
              )}`;
            setId(nextId);
          } else {
            setId(`${prefix}${(1).toString().padStart(9, "0")}`);
          }
          // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
        } catch {
        } finally {
          setLoading(false);
        }
      }
    } else {
      setId(newItemId);
    }
  };

  return { id, onIdChange, loading };
}
