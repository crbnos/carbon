import type { ApiAttribute, ApiQueryParam } from "@/lib/api-types";

export function prettyType(a: { type: string; format?: string }): string {
  if (a.format) {
    const enumName = a.format.match(/"([^"]+)"/);
    if (enumName) return enumName[1];
    if (a.format.includes("timestamp")) return "timestamp";
    if (["integer", "bigint", "numeric", "smallint", "double precision", "real"].includes(a.format))
      return "number";
    if (a.format === "date") return "date";
    if (a.format === "uuid") return "uuid";
    if (a.format === "boolean") return "boolean";
    if (a.format.startsWith("json")) return "object";
  }
  return a.type;
}

type Field = {
  name: string;
  type: string;
  format?: string;
  description?: string;
  required?: boolean;
  pk?: boolean;
  fk?: { table: string; column: string };
};

function Row({ field }: { field: Field }) {
  return (
    <div className="py-3.5">
      <div className="flex items-center gap-2 flex-wrap">
        <code className="font-mono text-ed-13 text-ed-ink">
          {field.name}
        </code>
        <span className="font-mono text-ed-12 text-ed-ink/54">
          {prettyType(field)}
        </span>
        {field.required && (
          <span className="text-ed-11 font-medium text-ed-amber-text">required</span>
        )}
        {field.pk && (
          <span className="text-ed-11 font-medium text-ed-brand-ink">primary key</span>
        )}
      </div>
      {field.description && (
        <p className="m-0 mt-1.5 text-ed-14 leading-normal text-ed-ink/74">
          {field.description}
        </p>
      )}
      {field.fk && (
        <p className="m-0 mt-1 text-ed-13 text-ed-ink/58">
          References{" "}
          <code className="font-mono">
            {field.fk.table}.{field.fk.column}
          </code>
        </p>
      )}
    </div>
  );
}

export function Fields({
  title,
  attributes,
  query,
}: {
  title: string;
  attributes?: ApiAttribute[];
  query?: ApiQueryParam[];
}) {
  const fields: Field[] = attributes ?? query?.map((q) => ({ ...q })) ?? [];
  if (!fields.length) return null;
  return (
    <div className="mt-7">
      <h3 className="m-0 mb-0.5 text-ed-13 font-semi uppercase tracking-[0.05em] text-ed-ink/58">
        {title}
      </h3>
      <div className="divide-y divide-ed-hairline border-t border-ed-hairline">
        {fields.map((f) => (
          <Row key={f.name} field={f} />
        ))}
      </div>
    </div>
  );
}
