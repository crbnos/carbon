import { Checkbox, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCheck,
  LuFileText,
  LuPencil,
  LuShapes,
  LuTrash,
  LuUser,
  LuUsers,
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";

import { flushSync } from "react-dom";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUrlParams } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import type { GaugeCalibrationRecord } from "../../types";

import { formatDate } from "@carbon/utils";
import { Enumerable } from "~/components/Enumerable";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { usePeople } from "~/stores";
import { GaugeCalibrationRecordStatus } from "./GaugeCalibrationRecordStatus";

type GaugeCalibrationRecordsTableProps = {
  data: GaugeCalibrationRecord[];
  types: ListItem[];
  count: number;
};

const defaultColumnVisibility = {
  gaugeTypeId: false,
  createdAt: false,
  updatedAt: false,
  updatedBy: false,
};

const GaugeCalibrationRecordsTable = memo(
  ({ data, types, count }: GaugeCalibrationRecordsTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const deleteDisclosure = useDisclosure();
    const [selectedGaugeCalibrationRecord, setSelectedGaugeCalibrationRecord] =
      useState<GaugeCalibrationRecord | null>(null);

    const customColumns = useCustomColumns<GaugeCalibrationRecord>(
      "gaugeCalibrationRecord"
    );

    const [people] = usePeople();

    const columns = useMemo<ColumnDef<GaugeCalibrationRecord>[]>(() => {
      const defaultColumns: ColumnDef<GaugeCalibrationRecord>[] = [
        {
          accessorKey: "gaugeId",
          header: "ID",
          cell: ({ row }) => (
            <Hyperlink to={path.to.gaugeCalibrationRecord(row.original.id!)}>
              <div className="flex flex-col gap-0">
                <span className="text-sm font-medium">
                  {row.original.gaugeReadableId}
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.original.description}
                </span>
              </div>
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />,
          },
        },
        {
          accessorKey: "dateCalibrated",
          header: "Date Calibrated",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />,
          },
        },
        {
          accessorKey: "inspectionStatus",
          header: "Inspection Status",
          cell: (item) => (
            <GaugeCalibrationRecordStatus
              status={item.getValue<string>() as "Pass" | "Fail"}
            />
          ),
          meta: {
            icon: <LuCheck />,
            filter: {
              type: "static",
              options: [
                {
                  value: "Pass",
                  label: <GaugeCalibrationRecordStatus status="Pass" />,
                },
                {
                  value: "Fail",
                  label: <GaugeCalibrationRecordStatus status="Fail" />,
                },
              ],
            },
          },
        },
        {
          accessorKey: "gaugeTypeId",
          header: "Type",
          cell: ({ row }) => (
            <Enumerable
              value={
                types.find((type) => type.id === row.original.gaugeTypeId)
                  ?.name ?? null
              }
            />
          ),
          meta: {
            icon: <LuShapes />,
            filter: {
              type: "static",
              options: types.map((type) => ({
                label: <Enumerable value={type.name} />,
                value: type.id,
              })),
            },
          },
        },
        {
          accessorKey: "requiresAction",
          header: "Requires Action",
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ],
            },
            icon: <LuCheck />,
          },
        },
        {
          accessorKey: "requiresAdjustment",
          header: "Requires Adjustment",
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ],
            },
            icon: <LuCheck />,
          },
        },
        {
          accessorKey: "requiresRepair",
          header: "Requires Repair",
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ],
            },
            icon: <LuCheck />,
          },
        },
        {
          id: "createdBy",
          header: "Created By",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: {
            icon: <LuUser />,
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name,
              })),
            },
          },
        },
        {
          accessorKey: "createdAt",
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuFileText />,
          },
        },
        {
          id: "updatedBy",
          header: "Updated By",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.updatedBy} />
          ),
          meta: {
            icon: <LuUsers />,
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name,
              })),
            },
          },
        },
        {
          accessorKey: "updatedAt",
          header: "Updated At",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuFileText />,
          },
        },
      ];
      return [...defaultColumns, ...customColumns];
    }, [customColumns, people, types]);

    const renderContextMenu = useCallback(
      (row: GaugeCalibrationRecord) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "quality")}
              onClick={() => {
                navigate(`${path.to.gauge(row.id!)}?${params?.toString()}`);
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Record
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "quality")}
              onClick={() => {
                flushSync(() => {
                  setSelectedGaugeCalibrationRecord(row);
                });
                deleteDisclosure.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Record
            </MenuItem>
          </>
        );
      },
      [navigate, permissions, deleteDisclosure, params]
    );

    return (
      <>
        <Table<GaugeCalibrationRecord>
          data={data}
          columns={columns}
          count={count}
          defaultColumnVisibility={defaultColumnVisibility}
          primaryAction={
            permissions.can("create", "quality") && (
              <New
                label="Record"
                to={`${
                  path.to.newGaugeCalibrationRecord
                }?${params?.toString()}`}
              />
            )
          }
          renderContextMenu={renderContextMenu}
          title="Calibration Records"
          table="gaugeCalibrationRecord"
          withSavedView
        />
        {deleteDisclosure.isOpen && selectedGaugeCalibrationRecord && (
          <ConfirmDelete
            action={path.to.deleteGaugeCalibrationRecord(
              selectedGaugeCalibrationRecord.id!
            )}
            isOpen
            onCancel={() => {
              setSelectedGaugeCalibrationRecord(null);
              deleteDisclosure.onClose();
            }}
            onSubmit={() => {
              setSelectedGaugeCalibrationRecord(null);
              deleteDisclosure.onClose();
            }}
            name={`record for ${
              selectedGaugeCalibrationRecord.gaugeId ?? "gauge"
            }`}
            text="Are you sure you want to delete this record?"
          />
        )}
      </>
    );
  }
);

GaugeCalibrationRecordsTable.displayName = "GaugeCalibrationRecordsTable";
export default GaugeCalibrationRecordsTable;
