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

  let d = new Date(start);
  let e = new Date(end);

  if (d > e) return {};

  while (d <= e) {
    const date = d.toISOString().split("T")[0];
    result[date] = [];
    d.setDate(d.getDate() + 1);
  }

  data.forEach((d) => {
    const date = new Date(d[groupBy]!.toString()).toISOString().split("T")[0];
    result[date]?.push(d);
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

  let d = new Date(start);
  let e = new Date(end);

  if (d > e) return {};

  while (d <= e) {
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
    result[monthKey] = [];
    d.setMonth(d.getMonth() + 1);
  }

  data.forEach((item) => {
    const date = new Date(item[groupBy]!.toString());
    const monthKey = `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, "0")}`;
    if (result[monthKey]) {
      result[monthKey].push(item);
    }
  });

  return result;
}
