// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuMail, LuPhone, LuUser } from "react-icons/lu";
import { Table } from "~/components";
import type { Contact } from "../../types";

type ContactTableProps = {
  data: Contact[];
  count: number;
};

const ContactTable = memo(({ data, count }: ContactTableProps) => {
  const { t } = useLingui();
  const columns = useMemo<ColumnDef<Contact>[]>(() => {
    return [
      {
        accessorKey: "firstName",
        header: t`First Name`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuUser />
        }
      },
      {
        accessorKey: "lastName",
        header: t`Last Name`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuUser />
        }
      },
      {
        accessorKey: "email",
        header: t`Email`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuMail />
        }
      },
      {
        accessorKey: "mobilePhone",
        header: t`Mobile Phone`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuPhone />
        }
      },
      {
        accessorKey: "workPhone",
        header: t`Work Phone`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuPhone />
        }
      },
      {
        accessorKey: "homePhone",
        header: t`Home Phone`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuPhone />
        }
      }
    ];
  }, [t]);

  return (
    <Table<Contact>
      count={count}
      columns={columns}
      data={data}
      defaultColumnPinning={{
        left: ["Select"]
      }}
      title={t`Contacts`}
      table="contact"
    />
  );
});

ContactTable.displayName = "ContactTable";

export default ContactTable;
