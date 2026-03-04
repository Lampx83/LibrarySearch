import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const isPortalEmbed = process.env.VITE_PORTAL_EMBED === "1"
const embedBase = process.env.EMBED_BASE_PATH || "/embed/library-search/"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: isPortalEmbed || process.env.PACK_BASEPATH ? embedBase : "/",
  server: { port: 3002, proxy: { "/api": "http://localhost:8001", "/health": "http://localhost:8001" } },
})
