/* Dev health check. Never returns the key. */
import { apolloConfigured } from "../lib/apollo/client.js";

export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    source: "api/test-apollo",
    apolloConfigured: apolloConfigured(),
    mockMode: !apolloConfigured() && process.env.NODE_ENV !== "production",
  });
}
