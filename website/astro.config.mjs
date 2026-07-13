import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://tact.0x81.hk",
  output: "static",
  trailingSlash: "never",
  vite: {
    preview: {
      allowedHosts: ["website", "localhost", "127.0.0.1"],
    },
  },
});
