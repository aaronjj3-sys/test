/* Copy to app/config.js and fill in your Supabase project's PUBLIC values.
   These are safe for the browser (anon key is public by design; RLS protects data).
   app/config.js is gitignored. Without it, the app runs in dev mode (no real auth). */

window.KNOCK_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-ANON-PUBLIC-KEY",
};
