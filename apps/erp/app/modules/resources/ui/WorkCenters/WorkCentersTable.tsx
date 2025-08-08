import { useCarbon } from "@carbon/auth";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  HStack,
  MenuIcon,
  MenuItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  toast,
  useDisclosure,
  useMount,
} from "@carbon/react";
import { useFetcher, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuAlignLeft,
  LuBuilding2,
  LuCheck,
  LuCog,
  LuDollarSign,
  LuPencil,
  LuTrash,
  LuTriangleAlert,
  LuUser,
  LuWrench,
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useProcesses } from "~/components/Form/Process";
import { Confirm } from "~/components/Modals";
import {
  useCurrencyFormatter,
  usePermissions,
  useUrlParams,
  useUser,
} from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { WorkCenter } from "~/modules/resources";
import { usePeople } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type WorkCentersTableProps = {
  data: WorkCenter[];
  count: number;
  locations: ListItem[];
};

const defaultColumnVisibility = {
  description: false,
  createdAt: false,
  createdBy: false,
  updatedAt: false,
  updatedBy: false,
};

const WorkCentersTable = memo(
  ({ data, count, locations }: WorkCentersTableProps) => {
    const navigate = useNavigate();
    const [params] = useUrlParams();
    const [people] = usePeople();

    const permissions = usePermissions();
    const deleteModal = useDisclosure();
    const activateModal = useDisclosure();
    const [selectedWorkCenter, setSelectedWorkCenter] =
      useState<WorkCenter | null>(null);

    const formatter = useCurrencyFormatter();
    const processes = useProcesses();

    const onActivate = (data: WorkCenter) => {
      setSelectedWorkCenter(data);
      activateModal.onOpen();
    };

    const onDelete = (data: WorkCenter) => {
      setSelectedWorkCenter(data);
      deleteModal.onOpen();
    };

    const onCancel = () => {
      setSelectedWorkCenter(null);
      deleteModal.onClose();
      activateModal.onClose();
    };

    const customColumns = useCustomColumns<WorkCenter>("workCenter");
    const columns = useMemo<ColumnDef<WorkCenter>[]>(() => {
      const defaultColumns: ColumnDef<WorkCenter>[] = [
        {
          accessorKey: "name",
          header: "Work Center",
          cell: ({ row }) => (
            <HStack>
              {((row.original.processes as any[]) ?? []).length > 0 ? (
                <Hyperlink to={row.original.id!}>
                  <Enumerable
                    value={row.original.name}
                    className="cursor-pointer"
                  />
                </Hyperlink>
              ) : (
                <Hyperlink to={row.original.id!}>
                  <HStack spacing={2}>
                    <LuTriangleAlert />
                    <span>{row.original.name}</span>
                  </HStack>
                </Hyperlink>
              )}
            </HStack>
          ),
          meta: {
            icon: <LuWrench />,
          },
        },
        {
          id: "processes",
          header: "Processes",
          cell: ({ row }) => (
            <span className="flex gap-2 items-center flex-wrap py-2">
              {((row.original.processes ?? []) as Array<string>).map((p) => {
                const process = processes.find((proc) => proc.value === p);
                return (
                  <Enumerable
                    key={process?.label}
                    value={process?.label ?? null}
                    onClick={() => navigate(path.to.process(process?.value!))}
                    className="cursor-pointer"
                  />
                );
              })}
            </span>
          ),
          meta: {
            icon: <LuCog />,
            filter: {
              type: "static",
              options: processes.map((process) => ({
                value: process.value,
                label: <Enumerable value={process.label} />,
              })),
              isArray: true,
            },
          },
        },
        {
          accessorKey: "locationName",
          header: "Location",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            icon: <LuBuilding2 />,
            filter: {
              type: "static",
              options: locations.map(({ name }) => ({
                value: name,
                label: <Enumerable value={name} />,
              })),
            },
          },
        },
        {
          accessorKey: "active",
          header: "Active",
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive" },
              ],
            },
            pluralHeader: "Active Statuses",
            icon: <LuCheck />,
          },
        },
        {
          accessorKey: "description",
          header: "Description",
          cell: ({ row }) => (
            <span className="max-w-[300px] line-clamp-1">
              {row.original.description}
            </span>
          ),
          meta: {
            icon: <LuAlignLeft />,
          },
        },
        {
          accessorKey: "laborRate",
          header: "Labor Rate",
          cell: ({ row }) => (
            <span>{formatter.format(row.original.laborRate ?? 0)}</span>
          ),
          meta: {
            icon: <LuDollarSign />,
          },
        },
        {
          accessorKey: "machineRate",
          header: "Machine Rate",
          cell: ({ row }) => (
            <span>{formatter.format(row.original.machineRate ?? 0)}</span>
          ),
          meta: {
            icon: <LuDollarSign />,
          },
        },
        {
          accessorKey: "overheadRate",
          header: "Overhead Rate",
          cell: ({ row }) => (
            <span>{formatter.format(row.original.overheadRate ?? 0)}</span>
          ),
          meta: {
            icon: <LuDollarSign />,
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
          id: "updatedBy",
          header: "Updated By",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.updatedBy} />
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
      ];
      return [...defaultColumns, ...customColumns];
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params, customColumns]);

    const renderContextMenu = useCallback<(row: WorkCenter) => JSX.Element>(
      (row) => (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.workCenter(row.id!)}?${params?.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Work Center
          </MenuItem>
          {row.active ? (
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "resources")}
              onClick={() => onDelete(row)}
            >
              <MenuIcon icon={<LuTrash />} />
              Deactivate Work Center
            </MenuItem>
          ) : (
            <MenuItem
              disabled={!permissions.can("delete", "resources")}
              onClick={() => onActivate(row)}
            >
              <MenuIcon icon={<LuCheck />} />
              Activate Work Center
            </MenuItem>
          )}
        </>
      ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [navigate, params, permissions]
    );

    return (
      <>
        <Table<WorkCenter>
          data={data}
          defaultColumnVisibility={defaultColumnVisibility}
          columns={columns}
          count={count ?? 0}
          primaryAction={
            permissions.can("update", "resources") && (
              <New label="Work Center" to={`new?${params.toString()}`} />
            )
          }
          renderContextMenu={renderContextMenu}
          title="Work Centers"
          table="workCenter"
          withSavedView
        />

        {selectedWorkCenter && selectedWorkCenter.id && (
          <DeleteWorkCenterModal
            workCenter={selectedWorkCenter}
            isOpen={deleteModal.isOpen}
            onCancel={onCancel}
            onSubmit={onCancel}
          />
        )}

        {selectedWorkCenter && selectedWorkCenter.id && (
          <Confirm
            action={path.to.workCenterActivate(selectedWorkCenter.id)}
            title={`Activate ${selectedWorkCenter?.name} Work Center`}
            text={`Are you sure you want to activate the ${selectedWorkCenter?.name} work center?`}
            confirmText="Activate"
            isOpen={activateModal.isOpen}
            onCancel={onCancel}
            onSubmit={onCancel}
          />
        )}
      </>
    );
  }
);

WorkCentersTable.displayName = "WorkCentersTable";
export default WorkCentersTable;

function DeleteWorkCenterModal({
  workCenter,
  isOpen,
  onCancel,
  onSubmit,
}: {
  workCenter: WorkCenter;
  isOpen: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const [hasNoActiveOperations, setHasNoActiveOperations] = useState(false);
  const [jobsWithActiveOperations, setJobsWithActiveOperations] = useState<
    {
      jobId: string;
      id: string;
    }[]
  >([]);

  const uniqueJobsWithActiveOperations = useMemo(() => {
    return jobsWithActiveOperations.filter(
      (job, index, self) =>
        index === self.findIndex((t) => t.jobId === job.jobId)
    );
  }, [jobsWithActiveOperations]);

  const { carbon } = useCarbon();
  const { company } = useUser();

  const getActiveOperations = async () => {
    if (!carbon) return;
    const { data, error } = await carbon
      .from("jobOperation")
      .select("job(jobId, id, status)")
      .in("job.status", ["Ready", "In Progress", "Paused"])
      .neq("status", "Done")
      .eq("workCenterId", workCenter.id!)
      .eq("companyId", company?.id);
    if (error) {
      console.error(error);
    }

    if (data) {
      setJobsWithActiveOperations(
        data.map((job) => job.job).filter((job) => Boolean(job))
      );
      setHasNoActiveOperations(data.length === 0);
    } else {
      toast.error("Failed to check active operations");
    }
  };

  const fetcher = useFetcher<{}>();
  const submitted = useRef(false);
  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      onSubmit?.();
      submitted.current = false;
    }
  }, [fetcher.state, onSubmit]);

  useMount(() => {
    getActiveOperations();
  });

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Deactivate {workCenter.name}</ModalTitle>
        </ModalHeader>

        <ModalBody>
          {uniqueJobsWithActiveOperations.length > 0 ? (
            <Alert variant="destructive">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                Theses jobs have operations assigned to this work center:
              </AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 mt-2 space-y-1">
                  {uniqueJobsWithActiveOperations.map((job, index) => (
                    <li key={index} className="text-sm font-medium flex gap-2">
                      <Hyperlink to={path.to.jobDetails(job.id)}>
                        {job.jobId}
                      </Hyperlink>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : (
            <p>
              Are you sure you want to deactivate the {workCenter.name} work
              center?
            </p>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <fetcher.Form
            method="post"
            action={path.to.deleteWorkCenter(workCenter.id!)}
            onSubmit={() => (submitted.current = true)}
          >
            <Button
              variant="destructive"
              isLoading={fetcher.state !== "idle"}
              isDisabled={
                fetcher.state !== "idle" || hasNoActiveOperations === false
              }
              type="submit"
            >
              Deactivate
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
