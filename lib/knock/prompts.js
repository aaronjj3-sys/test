/* Internal prompts and strict JSON schemas for Scout, the outreach agent.
   Every builder serializes ONLY whitelisted fields of the profile/door (never
   raw Apollo blobs) and returns { system, prompt } pairs for openaiJSON,
   except resumeSystem() which returns the system string alone (the resume
   text itself is the user prompt). Schemas are OpenAI strict-mode compatible:
   additionalProperties:false and every property required, at every level. */

/* ---------------------------------------------------------------- schemas */

export const RESUME_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    fullName: { type: "string" },
    school: { type: "string", description: "Full official school name, correctly spelled" },
    degree: { type: "string", description: "Degree and major, e.g. B.A. Business Administration" },
    gradYear: { type: "string", description: "Graduation year, e.g. 2027" },
    location: { type: "string", description: "City, ST" },
    skills: { type: "array", items: { type: "string" }, description: "Tools and hard skills, max 14" },
    quantifiedWins: { type: "array", items: { type: "string" }, description: "Achievements with numbers, verbatim-ish" },
    experience: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          role: { type: "string" },
          org: { type: "string" },
          when: { type: "string", description: "e.g. 2023 · 2025 or 2024 · Present" },
          bullets: { type: "array", items: { type: "string" }, description: "Keep all meaningful bullets and numbers" },
        },
        required: ["role", "org", "when", "bullets"],
      },
      description: "Most recent first",
    },
    extraContext: { type: "string", description: "One or two sentences of notable context: clubs, projects, interests" },
  },
  required: ["fullName", "school", "degree", "gradYear", "location", "skills", "quantifiedWins", "experience", "extraContext"],
};

export const STYLE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sentenceLength: { type: "string", enum: ["short", "medium", "long"] },
    usesContractions: { type: "boolean" },
    formality: { type: "string", enum: ["casual", "neutral", "formal"] },
    energy: { type: "string", enum: ["calm", "warm", "upbeat"] },
    quirks: { type: "array", items: { type: "string" }, description: "Up to 4 distinctive habits, e.g. 'opens with a hook question'" },
    sampleOpener: { type: "string", description: "A first line in this person's voice; never contains an em dash or en dash" },
  },
  required: ["sentenceLength", "usesContractions", "formality", "energy", "quirks", "sampleOpener"],
};

export const RESUME_V2_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    fullName: { type: "string" },
    school: { type: "string", description: "Full official school name, correctly spelled" },
    degree: { type: "string", description: "Degree and major, e.g. B.A. Business Administration" },
    gradYear: { type: "string", description: "Graduation year, e.g. 2027" },
    location: { type: "string", description: "City, ST" },
    skills: { type: "array", items: { type: "string" }, description: "Tools and hard skills, max 14" },
    quantifiedWins: { type: "array", items: { type: "string" }, description: "Achievements with numbers, verbatim-ish" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                role: { type: "string" },
                org: { type: "string" },
                when: { type: "string" },
                bullets: { type: "array", items: { type: "string" }, description: "Keep all meaningful bullets and numbers" },
              },
              required: ["role", "org", "when", "bullets"],
            },
          },
        },
        required: ["title", "items"],
      },
    },
    experience: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          role: { type: "string" },
          org: { type: "string" },
          when: { type: "string" },
          bullets: { type: "array", items: { type: "string" }, description: "Keep all meaningful bullets and numbers" },
        },
        required: ["role", "org", "when", "bullets"],
      },
    },
    extraContext: { type: "string" },
  },
  required: ["fullName", "school", "degree", "gradYear", "location", "skills", "quantifiedWins", "sections", "experience", "extraContext"],
};

export const EMAIL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
  required: ["subject", "body"],
};

export const REPLY_CLASSIFICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: {
      type: "string",
      enum: ["positive_meeting", "positive_info", "question", "referral", "not_now", "negative", "auto_reply", "other"],
    },
    wantsCall: { type: "boolean", description: "True if they show willingness to get on a call" },
    sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
    summary: { type: "string", description: "One plain sentence under 25 words" },
    scheduling: {
      type: "object",
      additionalProperties: false,
      properties: {
        intent: {
          type: "string",
          enum: ["none", "asks_availability", "proposes_time", "confirms_time", "reschedule"],
        },
        timeText: { type: "string", description: "The exact scheduling phrase from the recipient, or empty" },
        dateTime: { type: "string", description: "ISO-like local date/time if unmistakably specified, otherwise empty" },
      },
      required: ["intent", "timeText", "dateTime"],
    },
  },
  required: ["type", "wantsCall", "sentiment", "summary", "scheduling"],
};

/* ------------------------------------------------ whitelisted serializers */

const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");

function profileFacts(profile = {}) {
  return {
    fullName: clip(profile.fullName, 80),
    school: clip(profile.school, 120),
    degree: clip(profile.degree, 120),
    gradYear: clip(profile.gradYear, 8),
    location: clip(profile.location, 80),
    skills: (profile.skills || []).slice(0, 14).map((s) => clip(s, 60)),
    quantifiedWins: (profile.quantifiedWins || []).slice(0, 6).map((w) => clip(w, 200)),
    experience: (profile.experience || []).slice(0, 5).map((e) => ({
      role: clip(e?.role, 90),
      org: clip(e?.org, 60),
      when: clip(e?.when, 30),
      bullets: (e?.bullets || []).slice(0, 3).map((b) => clip(b, 200)),
    })),
    sections: (profile.sections || profile.resumeSections || []).slice(0, 6).map((section) => ({
      title: clip(section?.title, 60),
      items: (section?.items || []).slice(0, 5).map((e) => ({
        role: clip(e?.role, 90),
        org: clip(e?.org, 60),
        when: clip(e?.when, 30),
        bullets: (e?.bullets || []).slice(0, 3).map((b) => clip(b, 200)),
      })),
    })),
    extraContext: clip(profile.extraContext, 400),
    story: clip(profile.story, 600),
  };
}

function doorFacts(door = {}) {
  return {
    name: clip(door.name, 80),
    firstName: clip(door.firstName, 40),
    title: clip(door.title, 120),
    companyName: clip(door.companyName, 120),
    companyDomain: clip(door.companyDomain, 80),
    location: clip(door.location, 80),
    seniority: clip(door.seniority, 40),
    signals: door.signals || {},
    matchReasons: (door.matchReasons || []).slice(0, 5).map((r) => clip(r, 160)),
  };
}

function signoffOf(profile = {}) {
  const raw = (profile.signoff || "").trim();
  if (raw) return raw.replace(/^-\s*/, "");
  return (profile.fullName || "Me").split(" ")[0];
}

function serializeThread(threadMessages = []) {
  return threadMessages
    .map((m, i) => {
      const head = [
        `[message ${i + 1}]`,
        `from: ${clip(m?.from, 120)}`,
        `date: ${clip(m?.date, 60)}`,
        m?.subject ? `subject: ${clip(m.subject, 150)}` : "",
      ].filter(Boolean).join("  ");
      return `${head}\n${clip(m?.body, 1500)}`;
    })
    .join("\n\n---\n\n");
}

/* ----------------------------------------------------- Scout system voice */

const SCOUT_SYSTEM = `You are Scout, an outreach agent that writes emails on behalf of a real student or early-career job-seeker. Your output is sent from their personal email account, so it must read like a real, specific human wrote it.

Grounding rules (non-negotiable):
- Use ONLY facts present in the provided profile, resume, recipient, and thread JSON. Never invent companies, numbers, metrics, dates, names, mutual connections, shared schools, articles read, or experiences.
- If a useful fact is missing, write around the gap instead of guessing. Never output placeholders like [Company] or [Name].
- Do not claim the sender saw a talk, read a post, or "has been following" the recipient unless that exact fact is in the input.

Email rules:
- Cold first emails: under 120 words. Replies and follow-ups: under 90 words.
- Exactly one specific ask: a 15-minute chat (unless the task says otherwise).
- No flattery walls. One concrete, grounded detail beats three vague compliments.
- Banned phrases: "synergy", "passionate", "I hope this finds you well", "I hope this email finds you well", "touch base", "circle back", "pick your brain".
- Plain text only. No markdown, no bullet symbols, no bold, no links unless a link is explicitly provided in the input.
- NEVER use an em dash or an en dash anywhere, including the subject line. Use a comma, a period, or restructure the sentence instead.
- Write at the sender's tone level and blend in their learned style profile when one is provided below.`;

/* Tone keys match lib/knock/drafts.js TONES exactly. */
export const TONE_GUIDES = {
  "Casual": "Relaxed and friendly, a little informal. Contractions everywhere, short sentences, the occasional fragment is fine. Reads like a smart student messaging someone they respect: still polite, never sloppy, no slang dumps.",
  "Sharp": "Confident and economical. Short declarative sentences, zero filler, leads with the strongest fact. Direct about wanting the meeting while staying respectful of the recipient's time.",
  "Polished": "Professional and composed. Complete sentences, few or no contractions, courteous phrasing. Reads like a carefully edited business email without becoming stiff or old-fashioned.",
  "Founder-like": "Builder energy. Talks about shipping, making, and doing, and references work already done. Slightly scrappy, action-first phrasing, comfortable with confident claims as long as the provided facts back them.",
  "Direct & warm": "Plainspoken and kind. Gets to the point quickly but with genuine warmth, and acknowledges the recipient is busy. Contractions are fine; slang is not.",
};

function toneBlock(tone) {
  const guide = TONE_GUIDES[tone] || TONE_GUIDES["Sharp"];
  const label = TONE_GUIDES[tone] ? tone : "Sharp";
  return `Sender's tone level: ${label}. ${guide}`;
}

function styleBlock(styleProfile) {
  if (!styleProfile || typeof styleProfile !== "object") return "";
  const lines = ["Learned style profile of the sender (blend it in; the tone level still leads):"];
  if (styleProfile.sentenceLength) lines.push(`- Sentence length: mostly ${styleProfile.sentenceLength} sentences.`);
  if (typeof styleProfile.usesContractions === "boolean") {
    lines.push(`- Contractions: ${styleProfile.usesContractions ? "use them naturally" : "avoid them; write words out"}.`);
  }
  if (styleProfile.formality) lines.push(`- Formality: ${styleProfile.formality}.`);
  if (styleProfile.energy) lines.push(`- Energy: ${styleProfile.energy}.`);
  if (styleProfile.quirks?.length) {
    lines.push(`- Habits to echo where natural: ${styleProfile.quirks.slice(0, 4).join("; ")}.`);
  }
  if (styleProfile.sampleOpener) {
    lines.push(`- A first line in their voice, for reference only, do not copy it verbatim: "${clip(styleProfile.sampleOpener, 200)}"`);
  }
  return lines.join("\n");
}

function scoutSystem(tone, styleProfile) {
  return [SCOUT_SYSTEM, toneBlock(tone), styleBlock(styleProfile)].filter(Boolean).join("\n\n");
}

/* ----------------------------------------------------------- the builders */

/** System message for resume parsing (the resume text is the user prompt). */
export function resumeSystem() {
  return `You parse resumes into structured profile data for a cold-outreach product. The output feeds emails sent under the person's real name, so accuracy matters more than polish.

Rules:
- Extract verbatim-faithfully. Keep the person's own numbers, metrics, and phrasing in quantifiedWins and experience bullets; light grammatical smoothing only.
- Correct obvious OCR artifacts and typos in proper nouns (school names, company names, cities). Change nothing else.
- NEVER fabricate. If a field is not in the resume, return an empty string or empty array for it. Do not infer a graduation year, GPA, location, or employer that is not written there.
- Preserve resume section headings in sections, e.g. Education, Professional Experience, Leadership, Extracurricular, Projects, Awards. Keep sections in resume order.
- Put work/professional roles in experience. Leadership, extracurricular, education, and project items should still appear in sections.
- Do not cap resume content. Extract every meaningful section in order and every role/item inside each section. Preserve all meaningful bullets for each item.
- skills should stay focused on tools and hard skills only, no soft skills. quantifiedWins should include achievements that contain a number.
- degree must include the major, e.g. "B.A. Business Administration". gradYear is a 4-digit year. location is "City, ST".
- extraContext: one or two sentences on notable clubs, projects, or interests that actually appear in the resume.
- Never use an em dash or en dash in any output field; use commas or hyphens.`;
}

/** Writing-style analysis. `samples` may be a string corpus or an array. */
export function stylePrompt(samples) {
  const corpus = Array.isArray(samples) ? samples.filter(Boolean).join("\n\n---\n\n") : String(samples || "");
  const system = `You analyze writing samples to capture someone's natural voice so an outreach tool can draft emails that sound like them. Describe how they actually write, not how they should write.

Rules:
- Base every field strictly on the samples. Do not flatter, idealize, or invent habits that are not observable in the text.
- quirks: up to 4 distinctive, concrete habits, e.g. "opens with a hook question" or "signs off with just a first initial".
- sampleOpener: one first line that sounds like this person. It must NEVER contain an em dash or en dash.`;
  const prompt = `Writing samples from one person, separated by ---:\n\n${clip(corpus, 12_000)}`;
  return { system, prompt };
}

/** First-touch cold email. */
export function draftEmailPrompt({ profile = {}, door = {}, tone, styleProfile } = {}) {
  const signoff = signoffOf(profile);
  const s = door.signals || {};
  const angle = s.founder
    ? "The recipient is a founder. The sender is a student who wants to learn from someone building at a higher level. Builder-respects-builder, not fan mail."
    : s.investor
      ? "The recipient is an investor. The sender wants to understand how investors actually evaluate early teams, from someone who does it."
      : s.hiring
        ? "The recipient's company is hiring. The sender is introducing themself directly instead of disappearing into an application portal."
        : "The recipient's path is close to the one the sender is working toward. Career-path curiosity, grounded in the facts below.";

  const prompt = `Write the sender's first cold email to this recipient.

SENDER PROFILE (the only sender facts you may use):
${JSON.stringify(profileFacts(profile), null, 2)}

RECIPIENT (the only recipient facts you may use):
${JSON.stringify(doorFacts(door), null, 2)}

Angle: ${angle}

Subject line rules:
- Under 7 words, specific to this recipient or company, no clickbait, no emoji.
- Mostly lowercase; capitalize proper nouns only.
- No em dashes or en dashes.

Body rules:
- Under 120 words, plain text, no markdown.
- Greet the recipient by first name.
- One or two sentences that show why this specific person, grounded only in the recipient facts above.
- One credibility line built from the sender's quantifiedWins or experience. If neither has anything usable, say the sender does their homework; do not invent numbers.
- One ask: a 15-minute chat in the next couple of weeks, flexible on timing.
- End the body with the sender's signoff exactly: "${signoff}".

Return JSON with "subject" and "body".`;
  return { system: scoutSystem(tone, styleProfile), prompt };
}

/** Premium improve pass over an existing draft. */
export function improvePrompt({ profile = {}, door = {}, subject = "", body = "" } = {}) {
  const system = `${SCOUT_SYSTEM}

You are acting as a senior editor on an existing draft, not a ghostwriter starting over. Preserve the sender's voice, their facts, and the overall structure. Your job is to raise clarity, specificity, and hook strength, especially the first line and the subject.`;
  const prompt = `Improve this outreach email draft.

SENDER PROFILE (for grounding only; do not introduce facts that are absent from both the draft and this profile):
${JSON.stringify(profileFacts(profile), null, 2)}

RECIPIENT:
${JSON.stringify(doorFacts(door), null, 2)}

CURRENT SUBJECT:
${clip(subject, 200)}

CURRENT BODY:
${clip(body, 4000)}

Editing rules:
- Sharpen the opening line so it earns the next sentence. Cut filler, hedges, and repeated ideas.
- Make vague claims concrete using only facts already in the draft or the profile above. NEVER add new facts, numbers, names, or claims.
- Keep the same single ask and the same signoff. Keep the sender's voice; do not make it sound corporate.
- Do not make the body longer than the original, and keep it under 120 words either way.
- Subject: under 7 words, mostly lowercase, specific, no clickbait, no em dashes or en dashes.

Return JSON with "subject" and "body".`;
  return { system, prompt };
}

/** Classify the recipient's reply in a thread. */
export function classifyReplyPrompt({ door = {}, threadMessages = [], now = new Date(), tz = "America/Los_Angeles" } = {}) {
  const system = `You triage replies to cold outreach emails for Scout, an outreach assistant for a student job-seeker. Read the thread and classify the most recent message from the recipient. Be literal: classify what they actually wrote, not what the sender hopes they meant. The summary is one plain sentence under 25 words and must never contain an em dash or en dash.`;
  const prompt = `RECIPIENT:
${JSON.stringify(doorFacts(door), null, 2)}

CURRENT DATE/TIME:
${now instanceof Date ? now.toISOString() : String(now)}
Timezone for scheduling: ${tz}

THREAD (oldest first; the first message is the sender's outreach, the last is the one to classify):
${serializeThread(threadMessages)}

Classification types:
- positive_meeting: they agree to meet or call, or propose a time.
- positive_info: friendly and helpful (shares info, offers to answer questions) but no meeting commitment yet.
- question: they ask the sender something that needs an answer before anything else.
- referral: they redirect to a different person or team.
- not_now: a deferral, e.g. busy now, ping me next month.
- negative: declines, not interested, or asks not to be contacted.
- auto_reply: out-of-office or any automated response.
- other: none of the above fits.

wantsCall is true whenever the message shows real willingness to get on a call, even if no time is set.

scheduling.intent:
- asks_availability: they ask when the sender is free, e.g. "what is your availability next week?"
- proposes_time: they suggest a specific day/time, e.g. "Tuesday at 2 works"
- confirms_time: they accept one of the sender's proposed options or clearly finalize a time
- reschedule: they need to move an existing/proposed time
- none: no scheduling action

Only fill scheduling.dateTime when the day and time are unmistakable. Otherwise leave it empty.

Return JSON with "type", "wantsCall", "sentiment", "summary", and "scheduling".`;
  return { system, prompt };
}

/** Auto-reply to a classified response. */
export function replyDraftPrompt({ profile = {}, door = {}, threadMessages = [], classification = {}, tone, styleProfile, meetLink, availabilityOptions = [], calendarEvent = null } = {}) {
  const signoff = signoffOf(profile);
  const link = typeof meetLink === "string" ? { url: meetLink, when: "" } : meetLink || null;
  const originalSubject =
    clip(threadMessages?.[0]?.subject, 150).replace(/^(\s*re:\s*)+/i, "").trim() ||
    `quick question about ${door.companyName || "your company"}`;

  const typeGuide = {
    positive_meeting: "They want to meet. Confirm enthusiasm briefly and make scheduling effortless.",
    positive_info: "They are friendly but have not committed to a call. Thank them, engage with what they shared, and gently restate the 15-minute ask.",
    question: "Answer their question first, directly and honestly, using only facts from the sender profile. Then restate the 15-minute ask in one line.",
    referral: "Thank them sincerely and ask if they would be open to a quick intro to the person they mentioned. Do not email the third party here.",
    not_now: "Accept gracefully with zero pressure. Ask if a specific later time (the timeframe they hinted at, if any) would work, and leave the door open.",
    negative: "Thank them for the direct answer, wish them well in one short line, and close the loop. No counter-pitch, no ask.",
    auto_reply: "This was an automated response. Write a one-line note suitable to send after they are back, referencing the original ask lightly.",
    other: "Respond naturally to whatever they actually said, keeping the original ask alive only if it fits.",
  }[classification?.type] || "Respond naturally to whatever they actually said.";

  const availabilityBlock = availabilityOptions?.length
    ? `\nAvailability options: offer these exact options and ask which one works best:\n${availabilityOptions.map((o, i) => `${i + 1}. ${clip(o.label || o.start?.dateTime || "", 120)}`).join("\n")}`
    : "";
  const calendarBlock = calendarEvent?.start
    ? `\nCalendar invite: a Google Calendar invite with Google Meet has already been sent for ${clip(calendarEvent.label || calendarEvent.start, 160)}. Do not include a raw Meet link unless explicitly asked. Briefly say you sent the calendar invite and ask them to confirm they received it.`
    : "";
  const meetBlock = link?.url && classification?.wantsCall && !calendarBlock
    ? `\nMeeting link: include this Google Meet link naturally in the body: ${clip(link.url, 300)}${link.when ? `\nProposed time to reference: ${clip(String(link.when), 200)}` : ""}\nOffer it as one easy option and stay flexible if the time does not work.`
    : "";

  const prompt = `Write the sender's reply to the most recent message in this thread.

SENDER PROFILE (the only sender facts you may use):
${JSON.stringify(profileFacts(profile), null, 2)}

RECIPIENT:
${JSON.stringify(doorFacts(door), null, 2)}

THREAD (oldest first; reply to the last message):
${serializeThread(threadMessages)}

CLASSIFICATION of their last message:
${JSON.stringify({
    type: classification?.type || "other",
    wantsCall: Boolean(classification?.wantsCall),
    sentiment: classification?.sentiment || "neutral",
    summary: clip(classification?.summary, 300),
  }, null, 2)}

Guidance for this reply type: ${typeGuide}${availabilityBlock}${calendarBlock}${meetBlock}

Rules:
- Under 90 words, plain text. Respond to what they actually wrote; never re-pitch the first email, they already read it.
- If they ask for availability, give options only. Do not create or mention a meeting link yet.
- If a calendar invite was already created, confirm the invite in a human way and do not offer unrelated times.
- Subject must be exactly: "Re: ${originalSubject}"
- End the body with the sender's signoff exactly: "${signoff}".
- No em dashes or en dashes anywhere.

Return JSON with "subject" and "body".`;
  return { system: scoutSystem(tone, styleProfile), prompt };
}

/** Polite follow-up nudge (max 2 per door). */
export function followupPrompt({ profile = {}, door = {}, previousMessage, followupNumber = 1, tone, styleProfile } = {}) {
  const signoff = signoffOf(profile);
  const prev = typeof previousMessage === "string" ? { subject: "", body: previousMessage } : previousMessage || {};
  const prevSubject =
    clip(prev.subject, 150).replace(/^(\s*re:\s*)+/i, "").trim() ||
    `quick question about ${door.companyName || "your company"}`;
  const n = followupNumber === 2 ? 2 : 1;
  const stance = n === 1
    ? "First nudge: assume the email simply got buried. Light, friendly, zero pressure."
    : "Second and FINAL nudge: make clear this is the last one, give them an easy out, and keep the door open if timing changes.";

  const prompt = `Write follow-up number ${n} (of a maximum of 2) to an email that got no reply.

SENDER PROFILE (the only sender facts you may use):
${JSON.stringify(profileFacts(profile), null, 2)}

RECIPIENT:
${JSON.stringify(doorFacts(door), null, 2)}

PREVIOUS EMAIL (the one being followed up on):
subject: ${prevSubject}
${clip(prev.body, 2000)}

Rules:
- ${stance}
- Under 60 words, plain text. Reference the original ask (15 minutes) without repeating the whole pitch and without guilt-tripping; never imply they owe a reply.
- Do not use stale bump phrases like "just bumping this" or "floating this to the top of your inbox". Add one tiny fresh angle from the sender profile if one exists; otherwise keep it simple.
- Subject must be exactly: "Re: ${prevSubject}"
- End the body with the sender's signoff exactly: "${signoff}".
- No em dashes or en dashes anywhere.

Return JSON with "subject" and "body".`;
  return { system: scoutSystem(tone, styleProfile), prompt };
}
