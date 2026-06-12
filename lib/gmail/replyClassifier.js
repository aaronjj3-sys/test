/* Reply classification now lives in lib/knock/replies.js (OpenAI-powered,
   shared with drafting). This module re-exports it so older import paths
   keep working. */

export { classifyReply } from "../knock/replies.js";
