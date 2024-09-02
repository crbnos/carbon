export const nestedObjectToPathObject = (
  val: any,
  acc: Record<string, any>,
  path: string
): any => {
  if (Array.isArray(val)) {
    val.forEach((v, index) =>
      nestedObjectToPathObject(v, acc, `${path}[${index}]`)
    );
    return acc;
  }

  if (typeof val === "object") {
    Object.entries(val).forEach(([key, value]) => {
      const nextPath = path ? `${path}.${key}` : key;
      nestedObjectToPathObject(value, acc, nextPath);
    });
    return acc;
  }

  if (val !== undefined) {
    acc[path] = val;
  }

  return acc;
};
