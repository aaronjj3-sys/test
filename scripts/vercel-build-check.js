import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const requiredFiles = [
  "index.html",
  "app/index.html",
];

const apiRoutes = [
  "api/test-apollo.js",
  "api/campaigns/create.js",
  "api/dashboard/doors.js",
  "api/sourcing/apollo.js",
  "api/sourcing/mock.js",
];

const missing = [];

for (const file of requiredFiles) {
  if (!existsSync(path.join(root, file))) missing.push(file);
}

for (const file of apiRoutes) {
  if (!existsSync(path.join(root, file))) missing.push(file);
}

if (missing.length > 0) {
  console.error("Static Knock build check failed. Missing required files:");
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

console.log("Static Knock build ready for Vercel");
