import { parseDate } from "@internationalized/date";

export function groupDataByDay<T extends object>(
  data: T[],
  args: {
    start: string;
    end: string;
    groupBy: keyof T;
  }
): Record<string, T[]> {
  const { start, end, groupBy } = args;

  const result: Record<string, T[]> = {};

  let d = parseDate(start);
  let e = parseDate(end);

  if (d > e) return {};

  while (d <= e) {
    const date = d.toString();
    result[date] = [];
    d = d.add({ days: 1 });
  }

  data.forEach((d) => {
    const date = d[groupBy]!.toString();
    result[date].push(d);
  });

  return result;
}

export function groupDataByMonth<T extends object>(
  data: T[],
  args: {
    start: string;
    end: string;
    groupBy: keyof T;
  }
): Record<string, T[]> {
  const { start, end, groupBy } = args;

  const result: Record<string, T[]> = {};

  let d = parseDate(start);
  let e = parseDate(end);

  if (d > e) return {};

  while (d <= e) {
    // Format as YYYY-MM
    const monthKey = `${d.year}-${String(d.month).padStart(2, "0")}`;
    result[monthKey] = [];
    d = d.add({ months: 1 });
  }

  data.forEach((item) => {
    const date = parseDate(item[groupBy]!.toString());
    const monthKey = `${date.year}-${String(date.month).padStart(2, "0")}`;
    if (result[monthKey]) {
      result[monthKey].push(item);
    }
  });

  return result;
}
