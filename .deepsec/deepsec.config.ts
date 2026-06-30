import { defineConfig } from "deepsec/config";

export default defineConfig({
  projects: [
    { id: "carbon", root: ".." },
    // <deepsec:projects-insert-above>
  ],
});
