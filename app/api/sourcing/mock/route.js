/* Next.js App Router adapter — always-mock sourcing for UI work. */
import { mockSourcing } from "../../../../lib/knock/mock.js";

export async function POST(req) {
  const input = await req.json().catch(() => ({}));
  return Response.json(mockSourcing(input));
}
