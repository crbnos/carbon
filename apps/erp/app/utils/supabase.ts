export function sanitize<T extends Record<string, any>>(
  input: T
): {
  [K in keyof T]: T[K] extends undefined ? null : T[K];
} {
  const output = { ...input } as {
    [K in keyof T]: T[K] extends undefined ? null : T[K];
  };
  Object.keys(output).forEach((key) => {
    if (output[key as keyof T] === undefined && key !== "id") {
      output[key as keyof T] = null as any;
    }
  });
  return output;
}
