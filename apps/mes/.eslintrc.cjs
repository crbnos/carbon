module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: ["carbon"],
  ignorePatterns: ["dist", ".eslintrc.cjs"],
  parser: "@typescript-eslint/parser",
};
