/* POST /api/sourcing/mock — same shape as /api/sourcing/apollo, always mock.
   Useful for UI work and demos without touching Apollo. */
import { mockSourcing } from "../../lib/knock/mock.js";

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  return res.status(200).json(mockSourcing(req.body || {}));
}
