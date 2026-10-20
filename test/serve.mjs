#!/usr/bin/env node
// Local test harness: serves saved xbox.com/play page snapshots with the site's CSS and the built
// userscript injected, so badges and the finder can be checked without installing anything.
//
//   node test/serve.mjs [snapshotDir] [port]
//
// snapshotDir holds HTML saved from the live site (outerHTML of #root, e.g. all_games.html).
// Snapshots can contain account details (gamerpic, name), so they are git-ignored.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAP_DIR = path.resolve(ROOT, process.argv[2] || "snapshots");
const PORT = Number(process.argv[3] || 8765);

// Stylesheets the live site loaded on 2026-10-20. Hashes change with site deploys; refresh if the harness looks unstyled.
const CSS = [
  "https://uhf.microsoft.com/statics/20261015.09.43/css/style-PF2pqjN1.css",
  ...[
    "xcloud-design-system-styles.fa39e9b6.css",
    "6590.091e0aa3.css",
    "9679.aa680f8e.css",
    "client.dd5b0327.css",
    "8925.2583a167.chunk.css",
    "876.499502dc.chunk.css",
    "1715.ae11ff10.chunk.css",
    "8201.b1cf27d7.chunk.css",
    "6488.19f5d63e.chunk.css",
    "search-page.26163e45.chunk.css",
    "5172.428c939c.chunk.css",
    "3708.89c5960f.chunk.css",
    "6883.f2f7c5d4.chunk.css",
    "2976.b05caf8c.chunk.css",
  ].map((f) => `https://assets.play.xbox.com/playxbox/static/css/${f}`),
];

function page(snapshot) {
  const html = fs.readFileSync(path.join(SNAP_DIR, snapshot), "utf8");
  return `<!doctype html><html class="global" dir="ltr" lang="en-US"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Harness: ${snapshot}</title>
${CSS.map((c) => `<link rel="stylesheet" href="${c}">`).join("\n")}
</head><body class="theme-dark">${html}
<script src="/dist/xbox-cloud-scores.user.js"></script></body></html>`;
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname === "/") {
        const snaps = fs.existsSync(SNAP_DIR) ? fs.readdirSync(SNAP_DIR).filter((f) => f.endsWith(".html")) : [];
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(
          `<!doctype html><meta charset="utf-8"><title>Harness</title><body style="font:16px system-ui;background:#111;color:#eee;padding:24px">
<h1>Userscript harness</h1><ul>${snaps.map((s) => `<li><a style="color:#9bf00b" href="/snap/${s}">${s}</a></li>`).join("")}</ul>
<p>Snapshots from ${SNAP_DIR}</p>`
        );
      }
      if (url.pathname.startsWith("/snap/")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(page(path.basename(url.pathname)));
      }
      if (url.pathname.startsWith("/dist/")) {
        const file = path.join(ROOT, "dist", path.basename(url.pathname));
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(fs.readFileSync(file));
      }
      res.writeHead(404).end("not found");
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`harness on http://127.0.0.1:${PORT}/ (snapshots: ${SNAP_DIR})`));
