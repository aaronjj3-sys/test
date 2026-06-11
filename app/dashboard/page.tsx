import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "./logout-button";

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const displayName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "there";

  return (
    <main className="dashboard-page">
      <div className="dash-shell">
        <aside className="dash-side">
          <a className="brand" href="/dashboard">
            knock<span>.</span>
          </a>
          <nav className="dash-nav" aria-label="Dashboard">
            <a href="/dashboard" aria-current="page">
              Dashboard
            </a>
            <a href="/dashboard">Find people</a>
            <a href="/dashboard">Inbox</a>
            <a href="/dashboard">Tracker</a>
          </nav>
          <div className="dash-user">{user.email}</div>
        </aside>

        <section className="dash-main">
          <div className="dash-top">
            <div>
              <h1>Welcome back, {displayName}.</h1>
              <p>Your Supabase session is active. Knock is ready for outreach workflows.</p>
            </div>
            <LogoutButton />
          </div>

          <div className="stat-grid">
            <article className="stat-card">
              <small>Knocks left</small>
              <strong>15</strong>
            </article>
            <article className="stat-card">
              <small>Doors found</small>
              <strong>0</strong>
            </article>
            <article className="stat-card">
              <small>Drafts ready</small>
              <strong>0</strong>
            </article>
            <article className="stat-card">
              <small>Replies</small>
              <strong>0</strong>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}
