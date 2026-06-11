/* Next.js App Router adapter — saved doors (localStorage-backed until Supabase wiring). */
export async function GET() {
  const dbConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  return Response.json({
    doors: [],
    meta: {
      persisted: dbConfigured ? "supabase-pending-wiring" : "client",
      note: dbConfigured
        ? "Supabase env present — server-side door storage is the next wiring step."
        : "No database configured; the app keeps doors in localStorage for now.",
    },
  });
}
