import { writeFileSync } from "fs";
(async () => {
  const response = await fetch(
    "http://localhost:54323/api/projects/default/api/rest"
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();

  // write the data to a javascript file using node fs module
  writeFileSync(
    "apps/carbon/app/lib/swagger-docs-schema.ts",
    `export default ${JSON.stringify(data, null, 2)}`
  );
})();
