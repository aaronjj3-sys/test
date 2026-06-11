/* GET /api/dashboard/doors — the user's saved doors.
   Until Supabase is wired server-side, doors persist in the client
   (localStorage) and this returns an empty set with a pointer. With
   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set, this is where the
   per-user query goes (auth token → user_id → select from doors). */

export default function handler(req, res) {
  const dbConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  res.status(200).json({
    doors: [],
    meta: {
      persisted: dbConfigured ? "supabase-pending-wiring" : "client",
      note: dbConfigured
        ? "Supabase env present — server-side door storage is the next wiring step."
        : "No database configured; the app keeps doors in localStorage for now.",
    },
  });
}
