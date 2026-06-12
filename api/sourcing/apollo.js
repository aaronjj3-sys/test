/* POST /api/sourcing/apollo — profile + ICP in, scored doors out.
   Search is credit-free; enrichment only runs when explicitly requested. */
import { sourceDoorsFromApollo } from "../../lib/apollo/sourcing.js";
import { apolloConfigured } from "../../lib/apollo/client.js";
import { mockSourcing } from "../../lib/knock/mock.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const input = req.body || {};
  if (!input.profile || typeof input.profile.story !== "string") {
    return res.status(400).json({ error: "profile.story is required" });
  }
  /* server-side pagination: int >= 1, defaults to 1, passed through to Apollo/mock */
  const page = Math.floor(Number(input.page));
  input.page = Number.isFinite(page) && page > 0 ? page : 1;

  if (!apolloConfigured()) {
    return res.status(200).json(mockSourcing(input)); // development fallback, clearly labeled
  }

  try {
    const result = await sourceDoorsFromApollo(input);
    return res.status(200).json(result);
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    return res.status(status).json({ error: err.message || "Apollo sourcing failed" });
  }
}
