/* Optional Claude integration, server-side only.
   Used to upgrade resume parsing and writing-style analysis when
   ANTHROPIC_API_KEY is set; everything has a deterministic fallback, so the
   product works without it. Claude Haiku 4.5 is used deliberately: these are
   small structured-extraction calls and the user asked to keep AI cost low.
   Raw fetch (no SDK) keeps this project dependency-free, same as the Apollo
   client. */

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 25_000;

export const claudeConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

function parseJSONText(text) {
  if (!text) return null;
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(trimmed); } catch { /* try object slice below */ }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

/** One structured-JSON call. Returns the parsed object, or null on any
    failure so callers can fall back to the deterministic path. */
export async function claudeJSON({ system, prompt, schema, maxTokens = 2000 }) {
  if (!claudeConfigured()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const baseBody = {
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  };

  try {
    let res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...baseBody,
        output_config: { format: { type: "json_schema", schema } },
      }),
    });

    if (!res.ok && [400, 404, 422].includes(res.status)) {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...baseBody,
          messages: [{
            role: "user",
            content: `${prompt}\n\nReturn only valid JSON matching this JSON schema:\n${JSON.stringify(schema)}`,
          }],
        }),
      });
    }

    if (!res.ok) {
      console.error("Claude API error:", res.status); // status only — never log keys or bodies
      return null;
    }
    const data = await res.json();
    if (data.stop_reason === "refusal") return null;
    const text = (data.content || []).find((b) => b.type === "text")?.text;
    return parseJSONText(text);
  } catch (err) {
    console.error("Claude call failed:", err.name === "AbortError" ? "timeout" : err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const RESUME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    fullName: { type: "string" },
    school: { type: "string", description: "Full official school name, correctly spelled" },
    degree: { type: "string", description: "Degree and major, e.g. B.A. Business Administration" },
    gradYear: { type: "string", description: "Graduation year, e.g. 2027" },
    location: { type: "string", description: "City, ST" },
    skills: { type: "array", items: { type: "string" }, description: "Tools and hard skills, max 14" },
    quantifiedWins: { type: "array", items: { type: "string" }, description: "Achievements with numbers, verbatim-ish, max 6" },
    experience: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          role: { type: "string" },
          org: { type: "string" },
          when: { type: "string", description: "e.g. 2023 · 2025 or 2024 · Present" },
          bullets: { type: "array", items: { type: "string" }, description: "max 3, keep numbers" },
        },
        required: ["role", "org", "when", "bullets"],
      },
      description: "Most recent first, max 5",
    },
    extraContext: { type: "string", description: "One or two sentences of notable context: clubs, projects, interests" },
  },
  required: ["fullName", "school", "degree", "gradYear", "location", "skills", "quantifiedWins", "experience", "extraContext"],
};

export const STYLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sentenceLength: { type: "string", enum: ["short", "medium", "long"] },
    usesContractions: { type: "boolean" },
    formality: { type: "string", enum: ["casual", "neutral", "formal"] },
    energy: { type: "string", enum: ["calm", "warm", "upbeat"] },
    quirks: { type: "array", items: { type: "string" }, description: "Up to 4 distinctive habits, e.g. 'opens with a hook question'" },
    sampleOpener: { type: "string", description: "A first line in this person's voice" },
  },
  required: ["sentenceLength", "usesContractions", "formality", "energy", "quirks", "sampleOpener"],
};
