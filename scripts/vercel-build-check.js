import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "public");

const envPath = path.join(root, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const requiredFiles = [
  "index.html",
  "app/index.html",
];

const apiRoutes = [
  "api/apollo/usage.js",
  "api/campaigns/create.js",
  "api/connections/disconnect.js",
  "api/connections/status.js",
  "api/cron/monitor.js",
  "api/dashboard/doors.js",
  "api/gmail/send.js",
  "api/gmail/sync.js",
  "api/google/callback.js",
  "api/google/connect.js",
  "api/knock/draft.js",
  "api/knock/improve.js",
  "api/linkedin/callback.js",
  "api/linkedin/connect.js",
  "api/profile/extract-text.js",
  "api/profile/parse-resume.js",
  "api/profile/analyze-style.js",
  "api/sourcing/apollo.js",
  "api/sourcing/enrich.js",
  "api/sourcing/mock.js",
];

const rootStaticFiles = [
  "index.html",
  "main.js",
  "styles.css",
  "privacy.html",
  "terms.html",
];

const appStaticFiles = [
  "index.html",
  "app.css",
  "app.js",
  "auth.js",
];

const optionalStaticDirs = [
  "assets",
  "vendor",
];

const missing = [];

for (const file of [...requiredFiles, ...apiRoutes]) {
  if (!existsSync(path.join(root, file))) missing.push(file);
}

if (missing.length > 0) {
  console.error("Static Knock build check failed. Missing required files:");
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const file of rootStaticFiles) {
  const src = path.join(root, file);
  if (existsSync(src)) cpSync(src, path.join(outDir, file));
}

const appOutDir = path.join(outDir, "app");
mkdirSync(appOutDir, { recursive: true });

for (const file of appStaticFiles) {
  const src = path.join(root, "app", file);
  if (existsSync(src)) cpSync(src, path.join(appOutDir, file));
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (supabaseUrl && supabaseAnonKey) {
  writeFileSync(
    path.join(appOutDir, "config.js"),
    `window.KNOCK_CONFIG = {\n  supabaseUrl: ${JSON.stringify(supabaseUrl)},\n  supabaseAnonKey: ${JSON.stringify(supabaseAnonKey)},\n};\n`,
  );
}

for (const dir of optionalStaticDirs) {
  const src = path.join(root, dir);
  if (existsSync(src)) {
    cpSync(src, path.join(outDir, dir), {
      recursive: true,
      filter: (source) => {
        const rel = path.relative(root, source).replaceAll("\\", "/");
        return ![
          "node_modules",
          ".git",
          ".next",
          "public",
          ".env",
          ".env.local",
          "server.js",
        ].some((blocked) => rel === blocked || rel.startsWith(`${blocked}/`));
      },
    });
  }
}

console.log("Static Knock build ready for Vercel");
