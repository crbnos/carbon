import type { AuditLogEntry } from "@carbon/database/audit.types";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle
} from "@carbon/react";
import { useNavigate, useOutletContext } from "react-router";
import { AuditLogTable } from "~/modules/settings";
import { path } from "~/utils/path";

export default function AuditLogDetailsRoute() {
  const { entries, count } = useOutletContext<{
    entries: AuditLogEntry[];
    count: number;
  }>();
  const navigate = useNavigate();
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) {
          navigate(path.to.auditLog);
        }
      }}
    >
      <DrawerContent size="full">
        <DrawerHeader>
          <DrawerTitle>All Audit Logs</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="p-0">
          <AuditLogTable entries={entries} count={count} />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
