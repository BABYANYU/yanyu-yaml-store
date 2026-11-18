import { defineConfig } from "vitest/config"
import { cloudflareTest } from "@cloudflare/vitest-plugin"

export default defineConfig({
  assetsInclude: ["frontend/*", "doc/*", "test/resources/*"],
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      wrangler: { configPath: "./wrangler.toml" },
    }),
  ],
  test: {
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json-summary", "html", "json"],
    },
  },
})
