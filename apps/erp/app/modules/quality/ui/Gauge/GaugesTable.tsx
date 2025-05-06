import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCircleCheck,
  LuCircleGauge,
  LuCircleX,
  LuContainer,
  LuFileText,
  LuHash,
  LuMap,
  LuPencil,
  LuShapes,
  LuShield,
  LuTrash,
  LuUser,
  LuUsers,
} from "react-icons/lu";
import {
  EmployeeAvatar,
  Hyperlink,
  New,
  SupplierAvatar,
  Table,
} from "~/components";

import { flushSync } from "react-dom";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUrlParams } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import type { Gauge } from "../../types";

import { formatDate } from "@carbon/utils";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { usePeople } from "~/stores/people";
import { useSuppliers } from "~/stores/suppliers";
import {
  gaugeCalibrationStatus,
  gaugeRole,
  gaugeStatus,
} from "../../quality.models";
import { GaugeCalibrationStatus, GaugeRole, GaugeStatus } from "./GaugeStatus";

type GaugesTableProps = {
  data: Gauge[];
  types: ListItem[];
  count: number;
};

const defaultColumnVisibility = {
  type: false,
  extension: false,
  createdAt: false,
  updatedAt: false,
  updatedBy: false,
  description: false,
};

const GaugesTable = memo(({ data, types, count }: GaugesTableProps) => {
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const deleteDisclosure = useDisclosure();
  const activateDisclosure = useDisclosure();
  const deactivateDisclosure = useDisclosure();

  const [selectedGauge, setSelectedGauge] = useState<Gauge | null>(null);
  const [people] = usePeople();

  const customColumns = useCustomColumns<Gauge>("gauge");
  const [suppliers] = useSuppliers();
  const locations = useLocations();

  const columns = useMemo<ColumnDef<Gauge>[]>(() => {
    const defaultColumns: ColumnDef<Gauge>[] = [
      {
        accessorKey: "gaugeId",
        header: "ID",
        cell: ({ row }) => (
          <Hyperlink to={path.to.gauge(row.original.id!)}>
            <div className="flex flex-col gap-0">
              <span className="text-sm font-medium">
                {row.original.gaugeId}
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
        id: "supplierId",
        header: "Supplier",
        cell: ({ row }) => {
          return <SupplierAvatar supplierId={row.original.supplierId} />;
        },
        meta: {
          filter: {
            type: "static",
            options: suppliers?.map((supplier) => ({
              value: supplier.id,
              label: supplier.name,
            })),
          },
          icon: <LuContainer />,
        },
      },
      {
        accessorKey: "modelNumber",
        header: "Model Number",
        cell: ({ row }) => row.original.modelNumber,
        meta: {
          icon: <LuHash />,
        },
      },
      {
        accessorKey: "serialNumber",
        header: "Serial Number",
        cell: ({ row }) => row.original.serialNumber,
        meta: {
          icon: <LuHash />,
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
        accessorKey: "gaugeCalibrationStatus",
        header: "Calibration Status",
        cell: ({ row }) => (
          <GaugeCalibrationStatus
            status={row.original.gaugeCalibrationStatus}
          />
        ),
        meta: {
          icon: <LuCircleGauge />,
          filter: {
            type: "static",
            options: gaugeCalibrationStatus.map((status) => ({
              label: <GaugeCalibrationStatus status={status} />,
              value: status,
            })),
          },
        },
      },
      {
        accessorKey: "gaugeRole",
        header: "Role",
        cell: ({ row }) => <GaugeRole role={row.original.gaugeRole} />,
        meta: {
          icon: <LuShield />,
          filter: {
            type: "static",
            options: gaugeRole.map((role) => ({
              label: <GaugeRole role={role} />,
              value: role,
            })),
          },
        },
      },
      {
        accessorKey: "gaugeStatus",
        header: "Status",
        cell: ({ row }) => <GaugeStatus status={row.original.gaugeStatus} />,
        meta: {
          icon: <LuCircleGauge />,
          filter: {
            type: "static",
            options: gaugeStatus.map((status) => ({
              label: status,
              value: status,
            })),
          },
        },
      },

      {
        accessorKey: "nextCalibrationDate",
        header: "Next Calibration",
        cell: ({ row }) => formatDate(row.original.nextCalibrationDate),
        meta: {
          icon: <LuCalendar />,
        },
      },
      {
        accessorKey: "lastCalibrationDate",
        header: "Last Calibration",
        cell: ({ row }) => formatDate(row.original.lastCalibrationDate),
        meta: {
          icon: <LuCalendar />,
        },
      },
      {
        accessorKey: "locationId",
        header: "Location",
        cell: ({ row }) => (
          <Enumerable
            value={
              locations.find(
                (location) => location.value === row.original.locationId
              )?.label ?? null
            }
          />
        ),
        meta: {
          icon: <LuMap />,
          filter: {
            type: "static",
            options: locations.map((location) => ({
              label: location.label,
              value: location.value,
            })),
          },
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
  }, [customColumns, locations, people, suppliers, types]);

  const renderContextMenu = useCallback(
    (row: Gauge) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "quality")}
            onClick={() => {
              navigate(`${path.to.gauge(row.id!)}?${params?.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Gauge
          </MenuItem>
          {row.gaugeStatus === "Active" ? (
            <MenuItem
              destructive
              disabled={!permissions.can("update", "quality")}
              onClick={() => {
                flushSync(() => {
                  setSelectedGauge(row);
                });
                deactivateDisclosure.onOpen();
              }}
            >
              <MenuIcon icon={<LuCircleX />} />
              Deactivate Gauge
            </MenuItem>
          ) : (
            <MenuItem
              disabled={!permissions.can("update", "quality")}
              onClick={() => {
                flushSync(() => {
                  setSelectedGauge(row);
                });
                activateDisclosure.onOpen();
              }}
            >
              <MenuIcon icon={<LuCircleCheck />} />
              Activate Gauge
            </MenuItem>
          )}
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "quality")}
            onClick={() => {
              flushSync(() => {
                setSelectedGauge(row);
              });
              deleteDisclosure.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Gauge
          </MenuItem>
        </>
      );
    },
    [
      permissions,
      navigate,
      params,
      deactivateDisclosure,
      activateDisclosure,
      deleteDisclosure,
    ]
  );

  return (
    <>
      <Table<Gauge>
        data={data}
        columns={columns}
        count={count}
        defaultColumnVisibility={defaultColumnVisibility}
        primaryAction={
          permissions.can("create", "quality") && (
            <New
              label="Gauge"
              to={`${path.to.newGauge}?${params?.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title="Gauges"
        table="gauge"
        withSavedView
      />
      {deleteDisclosure.isOpen && selectedGauge && (
        <ConfirmDelete
          action={path.to.deleteGauge(selectedGauge.id!)}
          isOpen
          onCancel={() => {
            setSelectedGauge(null);
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            setSelectedGauge(null);
            deleteDisclosure.onClose();
          }}
          name={selectedGauge.gaugeId ?? "gauge"}
          text="Are you sure you want to delete this gauge?"
        />
      )}
      {deleteDisclosure.isOpen && selectedGauge && (
        <ConfirmDelete
          action={path.to.deleteGauge(selectedGauge.id!)}
          isOpen
          onCancel={() => {
            setSelectedGauge(null);
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            setSelectedGauge(null);
            deleteDisclosure.onClose();
          }}
          name={selectedGauge.gaugeId ?? "gauge"}
          text="Are you sure you want to delete this gauge?"
        />
      )}
      {activateDisclosure.isOpen && selectedGauge && (
        <Confirm
          action={path.to.activateGauge(selectedGauge.id!)}
          isOpen
          onCancel={() => {
            setSelectedGauge(null);
            activateDisclosure.onClose();
          }}
          onSubmit={() => {
            setSelectedGauge(null);
            activateDisclosure.onClose();
          }}
          text="Are you sure you want to activate this gauge?."
          title={`Activate ${selectedGauge.gaugeId}`}
          confirmText={"Activate"}
        />
      )}
      {deactivateDisclosure.isOpen && selectedGauge && (
        <Confirm
          action={path.to.deactivateGauge(selectedGauge.id!)}
          isOpen
          onCancel={() => {
            setSelectedGauge(null);
            deactivateDisclosure.onClose();
          }}
          onSubmit={() => {
            setSelectedGauge(null);
            deactivateDisclosure.onClose();
          }}
          text="Are you sure you want to deactivate this gauge?."
          title={`Deactivate ${selectedGauge.gaugeId}`}
          confirmText={"Deactivate"}
        />
      )}
    </>
  );
});

GaugesTable.displayName = "GaugesTable";
export default GaugesTable;
