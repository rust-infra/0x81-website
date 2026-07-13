import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://tact.0x81.hk",
  output: "static",
  trailingSlash: "never",
  server: {
    allowedHosts: true,
  },
});
