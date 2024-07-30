import { writeFileSync } from "fs";
(async () => {
  try {
    const response = await fetch(
      "http://localhost:54323/api/projects/default/api/rest"
    );
    const data = await response.json();

    // write the data to a javascript file using node fs module
    writeFileSync(
      "apps/carbon/app/lib/swagger-docs-schema.ts",
      `export default ${JSON.stringify(data, null, 2)}`
    );
  } catch (error) {
    console.error(error);
  }
})();
