/* OpenAI integration, server-side only. Primary LLM for Scout: first-touch
   drafting, reply classification, auto-replies, and the premium "improve"
   flow. Mirrors lib/knock/claude.js conventions: raw fetch (no SDK), 25s
   timeout, and null on any failure so callers can fall back deterministically.
   GPT-5-family quirks handled here: max_completion_tokens (not max_tokens),
   no temperature override (only the default is supported), reasoning_effort
   instead ("minimal" for nano classification, "low" for mini drafting). */

const TIMEOUT_MS = 25_000;

export const openaiConfigured = () =>
  Boolean(process.env.CHATGPT_API_KEY || process.env.OPENAI_API_KEY);

const apiKey = () => process.env.CHATGPT_API_KEY || process.env.OPENAI_API_KEY;

/* Model routing (env-overridable).
   draft: first emails, auto-replies, follow-ups, resume/style extraction.
   classify: cheap reply triage. improve: the premium "improve" button. */
export const MODELS = {
  draft: process.env.OPENAI_MODEL_DRAFT || "gpt-5.4-mini",
  classify: process.env.OPENAI_MODEL_CLASSIFY || "gpt-5.4-nano",
  improve: process.env.OPENAI_MODEL_IMPROVE || "gpt-5.5",
};

/* If the API rejects a routed model as unknown (400/404), step down this
   chain once, then land on a model that is certain to exist. */
const FALLBACKS = {
  "gpt-5.4-mini": "gpt-5-mini",
  "gpt-5.4-nano": "gpt-5-nano",
  "gpt-5.5": "gpt-5.1",
};
const FINAL_FALLBACK = "gpt-4o-mini";

/** The user is adamant: NO em dashes ever in generated text.
    " — "/"—" read as a comma pause; "–" between digits keeps a hyphen
    (ranges like 2023–2025); any other en dash also becomes a comma. */
export function sanitizeNoEmDash(text) {
  if (typeof text !== "string" || !/[—–]/.test(text)) return text;
  return text
    .replace(/(\d)\s?–\s?(?=\d)/g, "$1-")   /* numeric ranges → hyphen */
    .replace(/[ \t]*[—–][ \t]*/g, ", ")     /* everything else → comma pause */
    .replace(/,(?:[ \t]*,)+/g, ",")         /* collapse ", ," from "x, — y" */
    .replace(/[ \t]{2,}/g, " ");
}

/** Walk any LLM output and sanitize every string field. */
function deepSanitize(value) {
  if (typeof value === "string") return sanitizeNoEmDash(value);
  if (Array.isArray(value)) return value.map(deepSanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepSanitize(v)]));
  }
  return value;
}

/** One Chat Completions call. Returns { ok, parsed?, unknownModel? }. */
async function callOnce({ system, prompt, schema, model, maxTokens, effort }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const body = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: maxTokens,
      response_format: {
        type: "json_schema",
        json_schema: { name: "result", strict: true, schema },
      },
    };
    /* reasoning_effort is a GPT-5-family knob; gpt-4o-* rejects it */
    if (/^gpt-5/.test(model)) body.reasoning_effort = effort;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("OpenAI API error:", res.status); // status only — never log keys or bodies
      let unknownModel = false;
      if (res.status === 400 || res.status === 404) {
        const err = await res.json().catch(() => null);
        const detail = `${err?.error?.code || ""} ${err?.error?.param || ""} ${err?.error?.message || ""}`;
        unknownModel =
          res.status === 404 ||
          (/model/i.test(detail) && /not.?found|does not exist|invalid|unknown|unsupported/i.test(detail));
      }
      return { ok: false, unknownModel };
    }
    const data = await res.json();
    const message = data.choices?.[0]?.message;
    if (!message || message.refusal) return { ok: false };
    return message.content ? { ok: true, parsed: JSON.parse(message.content) } : { ok: false };
  } catch (err) {
    console.error("OpenAI call failed:", err.name === "AbortError" ? "timeout" : err.message);
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/** One structured-JSON call with the model-fallback chain. Returns the parsed
    object (every string field em-dash-sanitized), or null on any failure so
    callers can fall back to the deterministic path. */
export async function openaiJSON({ system, prompt, schema, model = MODELS.draft, maxTokens = 2000, effort = "low" }) {
  if (!openaiConfigured()) return null;
  const chain = [...new Set([model, FALLBACKS[model] || FINAL_FALLBACK, FINAL_FALLBACK])];
  for (const m of chain) {
    const result = await callOnce({ system, prompt, schema, model: m, maxTokens, effort });
    if (result.ok) return deepSanitize(result.parsed);
    if (!result.unknownModel) return null; /* real failure: don't burn retries */
  }
  return null;
}
