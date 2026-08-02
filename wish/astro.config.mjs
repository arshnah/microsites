import { defineConfig } from "astro/config";

// Static output — same deploy model as every other arshnah microsite
// (static build + a sibling /api/*.js folder Vercel picks up as functions).
export default defineConfig({
  output: "static",
  site: "https://wish.arshnah.in",
});
