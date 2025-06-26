export const sanitize = (input: Record<string, any>) => {
  const output = { ...input };
  Object.keys(output).forEach((key) => {
    if (output[key] === undefined && key !== "id") output[key] = null;
  });
  return output;
};
