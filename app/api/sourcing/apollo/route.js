/* Next.js App Router adapter — same engine as api/sourcing/apollo.js (node server.js). */
import { sourceDoorsFromApollo } from "../../../../lib/apollo/sourcing.js";
import { apolloConfigured } from "../../../../lib/apollo/client.js";
import { mockSourcing } from "../../../../lib/knock/mock.js";

export async function POST(req) {
  const input = await req.json().catch(() => ({}));
  if (!input.profile || typeof input.profile.story !== "string") {
    return Response.json({ error: "profile.story is required" }, { status: 400 });
  }
  if (!apolloConfigured()) {
    if (process.env.NODE_ENV === "production") {
      return Response.json({ error: "Apollo is not configured on the server. Set APOLLO_API_KEY." }, { status: 500 });
    }
    return Response.json(mockSourcing(input));
  }
  try {
    return Response.json(await sourceDoorsFromApollo(input));
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    return Response.json({ error: err.message || "Apollo sourcing failed" }, { status });
  }
}
