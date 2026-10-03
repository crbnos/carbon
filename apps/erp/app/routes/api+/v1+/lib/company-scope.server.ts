// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The client a service is handed by the dispatcher: the caller's own, with
 * every `update` and `delete` on a table that has a `companyId` column also
 * filtered by the caller's company.
 *
 * Services match the row they write by its id (`.update(row).eq("id", id)`),
 * and row-level security lets a signed-in user reach every company they
 * belong to. So a user with company A active could change or delete a row of
 * their company B by sending its id — and since the dispatcher stamps the
 * active `companyId` into the payload, an update that spread it moved the row
 * to A. Filtering here closes that for every tool at once: a write can only
 * match a row that is already in the caller's company, whatever the service
 * filters on. A service that filters on `companyId` itself is unaffected.
 *
 * Reads, inserts, RPCs, storage and auth pass through untouched.
 */
export function scopedToCompany<Client extends object>(
  client: Client,
  companyId: string,
  companyTables: ReadonlySet<string>
): Client {
  // Methods are read off the real object and bound to it: supabase-js keeps
  // its state on `this`, which a proxy as receiver would not carry.
  const member = (target: object, property: string | symbol) => {
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  };

  return new Proxy(client, {
    get(target, property) {
      if (property !== "from") return member(target, property);
      return (table: string) => {
        const query = (target as { from(table: string): object }).from(table);
        if (!companyTables.has(table)) return query;
        return new Proxy(query, {
          get(builder, method) {
            if (method !== "update" && method !== "delete") {
              return member(builder, method);
            }
            return (...args: unknown[]) =>
              (
                builder as Record<
                  string,
                  (...args: unknown[]) => {
                    eq(column: string, value: string): unknown;
                  }
                >
              )
                [method](...args)
                .eq("companyId", companyId);
          }
        });
      };
    }
  });
}
