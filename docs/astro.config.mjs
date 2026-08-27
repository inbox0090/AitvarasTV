// @ts-check
import { defineConfig } from "astro/config"
import tailwindcss from "@tailwindcss/vite"
import mdx from "@astrojs/mdx"

export default defineConfig({
  site: "https://infinitel8p.github.io",
  base: "/Extreme-InfiniTV",
  trailingSlash: "ignore",
  build: {
    format: "directory",
  },
  integrations: [mdx()],
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      wrap: true,
    },
  },
})
