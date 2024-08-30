import { swaggerDocsSchema } from "@carbon/database";
import { cn } from "@carbon/react";
import { LuTable2 } from "react-icons/lu";
import { getBrowserEnv } from "~/config/env";
import type { ValidLang } from "~/modules/api";
import { CodeSnippet, Snippets } from "~/modules/api";

const { SUPABASE_ANON_PUBLIC } = getBrowserEnv();

type TableDocsProps = {
  endpoint: string;
  selectedLang: ValidLang;
  resourceId: string;
  resources: Record<
    string,
    { id: string; displayName: string; camelCase: string }
  >;
};

const TableDocs = ({
  endpoint,
  selectedLang,
  resourceId,
  resources,
}: TableDocsProps) => {
  const { paths, definitions } = swaggerDocsSchema;
  // @ts-ignore
  const resourcePaths = paths[`/${resourceId}`];
  // @ts-ignore
  const resourceDefinition = definitions?.[resourceId];
  const resourceMeta = resources[resourceId];
  const realtimeEnabled = true; // TODO: realtime is not available for a lot of tables (unless we enable it)

  const methods = Object.keys(resourcePaths ?? {}).map((x) => x.toUpperCase());
  const properties = Object.entries(resourceDefinition?.properties ?? []).map(
    ([id, val]: any) => ({
      ...val,
      id,
      required: resourceDefinition?.required?.includes(id),
    })
  );

  if (!paths || !definitions) return null;

  return (
    <>
      <h2 className="doc-section__table-name text-foreground mt-0 flex items-center px-6 gap-2">
        <span className="bg-muted p-2 rounded-lg">
          <LuTable2 size={18} />
        </span>
        <span className="text-2xl font-bold">{resourceId}</span>
      </h2>

      <div className="doc-section">
        <article className="code"></article>
      </div>
      {properties.length > 0 && (
        <div>
          {properties.map((x) => (
            <div className="doc-section py-4" key={x.id}>
              <div className="code-column text-foreground">
                <Param
                  key={x.id}
                  name={x.id}
                  type={x.type}
                  format={x.format}
                  isOptional={!x.required}
                  metadata={{
                    table: resourceId,
                    column: x.id,
                  }}
                />
              </div>
              <div className="code">
                <CodeSnippet
                  selectedLang={selectedLang}
                  snippet={Snippets.readColumns({
                    title: `Select ${x.id}`,
                    resourceId,
                    endpoint: endpoint,
                    apiKey: SUPABASE_ANON_PUBLIC,
                    columnName: x.id,
                  })}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      {methods.includes("GET") && (
        <>
          <h3 className="text-foreground mt-4 px-6">Read rows</h3>
          <div className="doc-section">
            <article className="code-column text-foreground">
              <p>
                To read rows in <code>{resourceId}</code>, use the{" "}
                <code>select</code> method.
              </p>
              <p>
                <a
                  href="https://supabase.com/docs/reference/javascript/select"
                  target="_blank"
                  rel="noreferrer"
                >
                  Learn more
                </a>
              </p>
            </article>
            <article className="code">
              <CodeSnippet
                selectedLang={selectedLang}
                snippet={Snippets.readAll(
                  resourceId,
                  endpoint,
                  SUPABASE_ANON_PUBLIC
                )}
              />
              <CodeSnippet
                selectedLang={selectedLang}
                snippet={Snippets.readColumns({
                  resourceId,
                  endpoint: endpoint,
                  apiKey: SUPABASE_ANON_PUBLIC,
                })}
              />
              <CodeSnippet
                selectedLang={selectedLang}
                snippet={Snippets.readForeignTables(
                  resourceId,
                  endpoint,
                  SUPABASE_ANON_PUBLIC
                )}
              />
              <CodeSnippet
                selectedLang={selectedLang}
                snippet={Snippets.readRange(
                  resourceId,
                  endpoint,
                  SUPABASE_ANON_PUBLIC
                )}
              />
            </article>
          </div>
          <div className="doc-section">
            <article className="code-column text-foreground">
              <h4 className="mt-0 text-white">Filtering</h4>
              <p>Supabase provides a wide range of filters.</p>
              <p>
                <a
                  href="https://supabase.com/docs/reference/javascript/using-filters"
                  target="_blank"
                  rel="noreferrer"
                >
                  Learn more
                </a>
              </p>
            </article>
            <article className="code">
              <CodeSnippet
                selectedLang={selectedLang}
                snippet={Snippets.readFilters(
                  resourceId,
                  endpoint,
                  SUPABASE_ANON_PUBLIC
                )}
              />
            </article>
          </div>
        </>
      )}
      {methods.includes("POST") && (
        <>
          <h3 className="text-foreground mt-4 px-6">Insert rows</h3>
          <div className="doc-section">
            <article className="code-column text-foreground">
              <p>
                <code>insert</code> lets you insert into your tables. You can
                also insert in bulk and do UPSERT.
              </p>
              <p>
                <code>insert</code> will also return the replaced values for
                UPSERT.
              </p>
              <p>
                <a
                  href="https://supabase.com/docs/reference/javascript/insert"
                  target="_blank"
                  rel="noreferrer"
                >
                  Learn more
                </a>
              </p>
            </article>
            <article className="code">
              <CodeSnippet
                selectedLang={selectedLang}
                snippet={Snippets.insertSingle(
                  resourceId,
                  endpoint,
                  SUPABASE_ANON_PUBLIC
                )}
              />
              <CodeSnippet
                selectedLang={selectedLang}
                snippet={Snippets.insertMany(
                  resourceId,
                  endpoint,
                  SUPABASE_ANON_PUBLIC
                )}
              />
              <CodeSnippet
                selectedLang={selectedLang}
                snippet={Snippets.upsert(
                  resourceId,
                  endpoint,
                  SUPABASE_ANON_PUBLIC
                )}
              />
            </article>
          </div>
        </>
      )}
      {methods.includes("PATCH") && (
        <>
          <h3 className="text-foreground mt-4 px-6">Update rows</h3>
          <div className="doc-section">
            <article className="code-column text-foreground">
              <p>
                <code>update</code> lets you update rows. <code>update</code>{" "}
                will match all rows by default. You can update specific rows
                using horizontal filters, e.g. <code>eq</code>, <code>lt</code>,
                and <code>is</code>.
              </p>
              <p>
                <code>update</code> will also return the replaced values for
                UPDATE.
              </p>
              <p>
                <a
                  href="https://supabase.com/docs/reference/javascript/update"
                  target="_blank"
                  rel="noreferrer"
                >
                  Learn more
                </a>
              </p>
            </article>
            <article className="code">
              <CodeSnippet
                selectedLang={selectedLang}
                snippet={Snippets.update(
                  resourceId,
                  endpoint,
                  SUPABASE_ANON_PUBLIC
                )}
              />
            </article>
          </div>
        </>
      )}
      {methods.includes("DELETE") && (
        <>
          <h3 className="text-foreground mt-4 px-6">Delete rows</h3>
          <div className="doc-section">
            <article className="code-column text-foreground">
              <p>
                <code>delete</code> lets you delete rows. <code>delete</code>{" "}
                will match all rows by default, so remember to specify your
                filters!
              </p>
              <p>
                <a
                  href="https://supabase.com/docs/reference/javascript/delete"
                  target="_blank"
                  rel="noreferrer"
                >
                  Learn more
                </a>
              </p>
            </article>
            <article className="code">
              <CodeSnippet
                selectedLang={selectedLang}
                snippet={Snippets.delete(
                  resourceId,
                  endpoint,
                  SUPABASE_ANON_PUBLIC
                )}
              />
            </article>
          </div>
        </>
      )}
      {realtimeEnabled &&
        (methods.includes("DELETE") ||
          methods.includes("POST") ||
          methods.includes("PATCH")) && (
          <>
            <h3 className="text-foreground mt-4 px-6">Subscribe to changes</h3>
            <div className="doc-section">
              <article className="code-column text-foreground">
                <p>
                  Supabase provides realtime functionality and broadcasts
                  database changes to authorized users depending on Row Level
                  Security (RLS) policies.
                </p>
                <p>
                  <a
                    href="https://supabase.com/docs/reference/javascript/subscribe"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Learn more
                  </a>
                </p>
              </article>
              <article className="code">
                <CodeSnippet
                  selectedLang={selectedLang}
                  snippet={Snippets.subscribeAll(
                    resourceMeta.camelCase,
                    resourceId
                  )}
                />
                <CodeSnippet
                  selectedLang={selectedLang}
                  snippet={Snippets.subscribeInserts(
                    resourceMeta.camelCase,
                    resourceId
                  )}
                />
                <CodeSnippet
                  selectedLang={selectedLang}
                  snippet={Snippets.subscribeUpdates(
                    resourceMeta.camelCase,
                    resourceId
                  )}
                />
                <CodeSnippet
                  selectedLang={selectedLang}
                  snippet={Snippets.subscribeDeletes(
                    resourceMeta.camelCase,
                    resourceId
                  )}
                />
                <CodeSnippet
                  selectedLang={selectedLang}
                  snippet={Snippets.subscribeEq(
                    resourceMeta.camelCase,
                    resourceId,
                    "column_name",
                    "someValue"
                  )}
                />
              </article>
            </div>
          </>
        )}
    </>
  );
};

type ParamProps = {
  name?: string;
  type?: string;
  format?: string;
  required?: boolean;
  metadata?: { table: string; column: string };
  isOptional?: boolean;
  isPrimitive?: boolean;
  children?: React.ReactNode;
};

const Param = ({
  name,
  isOptional,
  type,
  format,
  children,
  isPrimitive,
}: ParamProps) => {
  return (
    <>
      <div className="mb-4 flex items-center justify-between ">
        <div className="flex gap-2 items-center">
          <div className="flex items-center gap-2">
            <label className="font-mono text-xs uppercase text-foreground-lighter  min-w-[55px]">
              Column
            </label>
            <div className="flex items-center gap-4">
              <span className="text-md text-foreground pb-0.5">{name}</span>
            </div>
          </div>
        </div>
        <div
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs",
            !isOptional && "border-amber-700 bg-amber-300 text-amber-900 "
          )}
        >
          {isOptional ? "Optional" : "Required"}
        </div>
      </div>
      <div className="grid gap-2 mt-6">
        <div className="mb-4 flex items-center gap-2">
          <label className="font-mono text-xs uppercase text-foreground-lighter min-w-[55px]">
            Type
          </label>
          <div>
            <span className="flex grow-0 bg-muted px-2 py-0.5 rounded-md text-foreground-light">
              <span className="flex items-center gap-2 text-sm">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="16 18 22 12 16 6"></polyline>
                  <polyline points="8 6 2 12 8 18"></polyline>
                </svg>
                <span>{type}</span>
              </span>
            </span>
          </div>
        </div>
        <div className="mb-4 flex items-center gap-2">
          <label className="font-mono text-xs uppercase text-foreground-lighter min-w-[55px]">
            Format
          </label>
          <div>
            <span className="flex grow-0 bg-muted px-2 py-0.5 rounded-md text-foreground-light">
              <span className="flex items-center gap-2 text-sm">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                </svg>
                <span>{format}</span>
              </span>
            </span>
          </div>
        </div>
      </div>
    </>
  );
};

export default TableDocs;
