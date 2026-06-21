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
    <div className="py-[14px]">
      <div className="flex items-center gap-[8px] flex-wrap">
        <code className="font-[family-name:var(--font-mono)] text-[13.5px] text-[#262323]">
          {field.name}
        </code>
        <span className="font-[family-name:var(--font-mono)] text-[12px] text-[rgba(38,35,35,0.54)]">
          {prettyType(field)}
        </span>
        {field.required && (
          <span className="text-[11px] font-medium text-[#9C7136]">required</span>
        )}
        {field.pk && (
          <span className="text-[11px] font-medium text-[#1E84B0]">primary key</span>
        )}
      </div>
      {field.description && (
        <p className="m-0 mt-[6px] text-[14.5px] leading-[150%] text-[rgba(38,35,35,0.74)]">
          {field.description}
        </p>
      )}
      {field.fk && (
        <p className="m-0 mt-[4px] text-[13px] text-[rgba(38,35,35,0.58)]">
          References{" "}
          <code className="font-[family-name:var(--font-mono)]">
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
    <div className="mt-[28px]">
      <h3 className="m-0 mb-[2px] text-[13.5px] font-[560] uppercase tracking-[0.05em] text-[rgba(38,35,35,0.58)]">
        {title}
      </h3>
      <div className="divide-y divide-[#E7E7E3] border-t border-[#E7E7E3]">
        {fields.map((f) => (
          <Row key={f.name} field={f} />
        ))}
      </div>
    </div>
  );
}
