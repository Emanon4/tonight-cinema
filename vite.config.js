import { defineConfig } from "vite";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
const catalogVersion=createHash("sha256").update(readFileSync(new URL("./public/data/movies.json",import.meta.url))).digest("hex").slice(0,16);
export default defineConfig({
  base: "./",
  define: {__CATALOG_VERSION__: JSON.stringify(catalogVersion)},
  server: { proxy: { "/api": "http://127.0.0.1:8793" } },
  build: { target: "es2022" },
});
