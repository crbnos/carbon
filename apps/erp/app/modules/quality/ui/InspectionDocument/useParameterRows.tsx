// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { IconButton } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { LuTrash2 } from "react-icons/lu";
import { EditableText } from "~/components/Editable";
import {
  newParameterId,
  type ParameterRow,
  sendableParameters
} from "./autosave";
import { LOCAL_EDIT_RESULT } from "./editorModel";

/**
 * The plan's parameters as edited here, and the Parameters grid's columns.
 * They are autosaved as a whole list (`parametersPayload`) when they change.
 */
export function useParameterRows(
  initialParameters: Array<{ id: string; key: string; value: string }>,
  canUpdate: boolean
) {
  const { t } = useLingui();
  const [parameterRows, setParameterRows] = useState<ParameterRow[]>(() =>
    initialParameters.map(({ id, key, value }) => ({ id, key, value }))
  );
  const parametersPayload = useMemo(
    () => JSON.stringify(sendableParameters(parameterRows)),
    [parameterRows]
  );

  const handleAddParameter = useCallback(() => {
    setParameterRows((prev) => [
      ...prev,
      { id: newParameterId(), key: "", value: "" }
    ]);
  }, []);

  const handleDeleteParameter = useCallback((id: string) => {
    setParameterRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const parameterMutation = useCallback(
    async (accessorKey: string, newValue: string, row: ParameterRow) => {
      setParameterRows((prev) =>
        prev.map((r) =>
          r.id !== row.id
            ? r
            : { ...r, [accessorKey as "key" | "value"]: newValue }
        )
      );
      return LOCAL_EDIT_RESULT;
    },
    []
  );

  const parameterEditableComponents = useMemo(
    () => ({
      key: EditableText(parameterMutation),
      value: EditableText(parameterMutation)
    }),
    [parameterMutation]
  );

  const parameterColumns = useMemo<ColumnDef<ParameterRow>[]>(
    () => [
      { accessorKey: "key", header: t`Key`, size: 240 },
      { accessorKey: "value", header: t`Value`, size: 360 },
      {
        id: "actions",
        header: t`Actions`,
        size: 80,
        cell: ({ row }) =>
          canUpdate && (
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t`Delete parameter ${row.original.key}`}
              icon={<LuTrash2 />}
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteParameter(row.original.id);
              }}
            />
          )
      }
    ],
    [canUpdate, handleDeleteParameter, t]
  );

  return {
    parameterRows,
    parametersPayload,
    handleAddParameter,
    parameterColumns,
    parameterEditableComponents
  };
}
