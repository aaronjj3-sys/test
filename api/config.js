/* GET /api/config.js
   Public browser config only. This intentionally exposes only Supabase anon
   auth settings, never service-role keys or OAuth secrets. */

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  res.status(200).send(
    `window.KNOCK_CONFIG = Object.assign({}, window.KNOCK_CONFIG || {}, {\n` +
      `  supabaseUrl: ${JSON.stringify(supabaseUrl)},\n` +
      `  supabaseAnonKey: ${JSON.stringify(supabaseAnonKey)},\n` +
      `});\n`
  );
}
