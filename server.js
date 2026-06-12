/* Local dev server: serves the static site and routes /api/* to the
   Vercel-style handlers in ./api. Run with: node server.js
   Reads .env.local for APOLLO_API_KEY etc. (never sent to the browser). */

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8000;

/* load .env.local without a dependency */
const envPath = path.join(ROOT, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

function browserConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return `window.KNOCK_CONFIG = {\n  supabaseUrl: ${JSON.stringify(supabaseUrl)},\n  supabaseAnonKey: ${JSON.stringify(supabaseAnonKey)},\n};\n`;
}

function vercelRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
  return res;
}

async function handleApi(req, res, pathname) {
  const rel = pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  const candidates = [path.join(ROOT, "api", rel + ".js"), path.join(ROOT, "api", rel, "index.js")];
  const file = candidates.find((f) => existsSync(f));
  if (!file) return vercelRes(res).status(404).json({ error: "Not found" });

  /* parse JSON body like Vercel does */
  let body = "";
  for await (const chunk of req) body += chunk;
  try { req.body = body ? JSON.parse(body) : undefined; } catch { req.body = undefined; }

  const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`); // fresh import in dev
  try {
    await mod.default(req, vercelRes(res));
  } catch (err) {
    console.error("API error:", err.message); // message only — never log secrets
    if (!res.writableEnded) vercelRes(res).status(500).json({ error: "Internal server error" });
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);

  if (pathname === "/app/config.js") {
    const config = browserConfig();
    if (!config) { res.statusCode = 404; return res.end("Supabase browser config is not set"); }
    res.setHeader("Content-Type", "text/javascript");
    res.setHeader("Cache-Control", "no-store");
    return res.end(config);
  }

  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname);

  /* static files */
  let fp = path.join(ROOT, decodeURIComponent(pathname));
  if (!fp.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  try {
    if ((await stat(fp)).isDirectory()) fp = path.join(fp, "index.html");
  } catch { /* fall through to 404 */ }
  try {
    const data = await readFile(fp);
    res.setHeader("Content-Type", MIME[path.extname(fp)] || "application/octet-stream");
    if ([".html", ".css", ".js"].includes(path.extname(fp))) {
      res.setHeader("Cache-Control", "no-store");
    }
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    console.error("Close the other dev server or run with a different port, for example: PORT=8001 npm run dev");
    process.exit(1);
  }

  throw err;
});

server.listen(PORT, () => {
  console.log(`Knock dev server → http://localhost:${PORT}`);
  console.log(`  landing: http://localhost:${PORT}/`);
  console.log(`  app:     http://localhost:${PORT}/app/`);
  console.log(`  apollo:  ${process.env.APOLLO_API_KEY ? "configured" : "NOT configured (mock mode)"}`);
});
