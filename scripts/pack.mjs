#!/usr/bin/env node
/**
 * Đóng gói LibrarySearch (frontend) thành zip để cài từ AI Portal.
 * Chuẩn giống các app khác trong Tools: manifest + public/ trong zip, output vào dist/.
 *
 * Chạy: npm run pack  → dist/library-search-app-package.zip
 * Chạy: npm run pack:basepath  → dist/library-search-app-package-basepath.zip
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
const buildDir = path.join(root, "dist")
const outDir = path.join(root, "dist")
const manifestPath = path.join(root, "package", "manifest.json")
const baseName = process.env.PACK_BASEPATH ? "library-search-app-package-basepath" : "library-search-app-package"
const outZip = path.join(outDir, baseName + ".zip")

function addDirToZip(zip, localDir, zipPrefix = "") {
  if (!fs.existsSync(localDir)) return
  const items = fs.readdirSync(localDir)
  for (const item of items) {
    const full = path.join(localDir, item)
    const rel = zipPrefix ? path.join(zipPrefix, item) : item
    if (fs.statSync(full).isDirectory()) {
      addDirToZip(zip, full, rel)
    } else if (!rel.endsWith(".zip") && !rel.includes("library-search-app-package") && !rel.endsWith(".DS_Store")) {
      const zipDir = path.dirname(rel)
      zip.addLocalFile(full, zipDir ? zipDir + "/" : "", path.basename(rel))
    }
  }
}

async function main() {
  if (!fs.existsSync(manifestPath)) {
    console.error("Missing package/manifest.json")
    process.exit(1)
  }
  if (!fs.existsSync(buildDir)) {
    console.error("Missing dist/. Chạy: npm run build trước khi pack")
    process.exit(1)
  }
  const indexPath = path.join(buildDir, "index.html")
  if (!fs.existsSync(indexPath)) {
    console.error("Missing dist/index.html. Chạy: npm run build trước khi pack")
    process.exit(1)
  }

  const AdmZip = (await import("adm-zip")).default
  const zip = new AdmZip()

  zip.addLocalFile(manifestPath, "", "manifest.json")
  addDirToZip(zip, buildDir, "public")

  fs.mkdirSync(outDir, { recursive: true })
  zip.writeZip(outZip)
  console.log("Created:", outZip)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
