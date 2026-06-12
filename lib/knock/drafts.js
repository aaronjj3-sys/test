/* Deterministic draft generation, differentiated by tone and shaped by the
   user's learned styleProfile. No LLM call required; the same signature can
   later route through Claude for fully bespoke drafts. */

function firstWin(profile) {
  const wins = profile.quantifiedWins || [];
  if (wins.length) return wins[0];
  const m = (profile.story || "").match(/[^.]*\$?\d[\d,.]*[KkMm%+]?[^.]*/);
  return m ? m[0].trim() : null;
}

function whoAmI(profile) {
  const school = profile.school ? `${profile.school} student` : "student";
  const win = firstWin(profile);
  return win ? `a ${school} who ${win.replace(/^I\s+/i, "")}` : `a ${school}`;
}

/* ---- tone voices: each writes the same four beats differently ---- */
const TONES = {
  "Casual": {
    greeting: (n) => `Hey ${n},`,
    founderHook: (c, me) => `Saw what you're building at ${c} and had to reach out. I'm ${me}, and honestly, this is exactly the kind of company I want to learn from.`,
    investorHook: (c, me) => `I'm ${me}. I've been trying to learn how investors actually think, and your seat at ${c} is exactly the view I'm missing.`,
    hiringHook: (c) => `I saw ${c} is hiring and figured I'd skip the application portal and just say hi to a real person.`,
    defaultHook: (c, me) => `Came across your work at ${c}. I'm ${me}, and your path is pretty much the one I'm chasing.`,
    cred: (w) => `Quick context: I ${w}. I do my homework before I bug anyone.`,
    credFallback: "Quick context: I do my homework before I bug anyone.",
    ask: "Any chance you'd have 15 minutes in the next couple weeks? Totally flexible on timing.",
    close: "Thanks!",
  },
  "Sharp": {
    greeting: (n) => `Hi ${n},`,
    founderHook: (c, me) => `You're building ${c}. I'm ${me}. I want to learn from founders operating at a higher level than the people around me.`,
    investorHook: (c, me) => `I'm ${me}. I want to understand how ${c} evaluates early teams, from someone who actually does it.`,
    hiringHook: (c) => `${c} is hiring in my lane. I'd rather earn a conversation than be resume #400 in a portal.`,
    defaultHook: (c, me) => `Your work at ${c} is the path I'm working toward. I'm ${me}.`,
    cred: (w) => `Proof I'm worth 15 minutes: I ${w}.`,
    credFallback: "I come prepared and I don't waste people's time.",
    ask: "Can I get 15 minutes this week? I'll bring three specific questions, not a resume dump.",
    close: "Thanks,",
  },
  "Polished": {
    greeting: (n) => `Hello ${n},`,
    founderHook: (c, me) => `I have been following what you are building at ${c}, and it left an impression. I am ${me}, and I am working to learn from founders operating at the highest level.`,
    investorHook: (c, me) => `I am ${me}, and I am eager to understand how experienced investors at firms like ${c} evaluate early-stage opportunities.`,
    hiringHook: (c) => `I understand ${c} is growing its team, and I wanted to introduce myself directly rather than through an application portal.`,
    defaultHook: (c, me) => `I recently came across your work at ${c}. I am ${me}, and the path you have taken closely mirrors the one I hope to follow.`,
    cred: (w) => `For context, I ${w}, and I make a point of arriving prepared.`,
    credFallback: "I make a point of arriving prepared and being respectful of your time.",
    ask: "Would you be open to a brief 15-minute conversation in the coming weeks? I am happy to work entirely around your schedule.",
    close: "Best regards,",
  },
  "Founder-like": {
    greeting: (n) => `Hi ${n},`,
    founderHook: (c, me) => `Builder to builder: what you're doing at ${c} is the kind of thing I want my career to look like. I'm ${me}.`,
    investorHook: (c, me) => `I'm ${me}. I've built things, and now I want to understand the other side of the table, how ${c} decides what gets backed.`,
    hiringHook: (c) => `I build things first and ask permission later, which is why I'm emailing you directly instead of joining ${c}'s applicant pile.`,
    defaultHook: (c, me) => `I'm ${me}. I ship, I iterate, and your work at ${c} is the standard I'm aiming for.`,
    cred: (w) => `Receipts: I ${w}. Already sketching what I'd do in my first 30 days around your problem space.`,
    credFallback: "I show up with work already done, not just questions.",
    ask: "15 minutes, any slot you have. I'll bring something I made, not just a resume.",
    close: "Building,",
  },
  "Direct & warm": {
    greeting: (n) => `Hi ${n},`,
    founderHook: (c, me) => `Saw you're building at ${c}. I'm ${me}, and I'm trying to learn from founders operating at a much higher level.`,
    investorHook: (c, me) => `I'm ${me}, looking to learn from investors who sit close to operators and early-stage company building.`,
    hiringHook: (c) => `I saw ${c} has been hiring in areas close to my interests, and I wanted to reach out directly instead of dropping into an application portal.`,
    defaultHook: (c, me) => `I came across your work at ${c}. I'm ${me}, and the path you've taken is close to the one I'm working toward.`,
    cred: (w) => `For context: I ${w}, so I show up prepared and I don't waste people's time.`,
    credFallback: "I do my homework before I reach out, and I don't waste people's time.",
    ask: "Would you be open to 15 minutes sometime in the next couple of weeks? Happy to work around your schedule.",
    close: "Thanks,",
  },
};

/* ---- styleProfile shaping ---- */
function expandContractions(s) {
  return s
    .replace(/\bI'm\b/g, "I am").replace(/\byou're\b/gi, "you are").replace(/\bI've\b/g, "I have")
    .replace(/\bdon't\b/gi, "do not").replace(/\bcan't\b/gi, "cannot").replace(/\bwon't\b/gi, "will not")
    .replace(/\bI'd\b/g, "I would").replace(/\bI'll\b/g, "I will").replace(/\bit's\b/gi, "it is")
    .replace(/\bthat's\b/gi, "that is").replace(/\bwhat's\b/gi, "what is").replace(/\byou'd\b/gi, "you would");
}

function applyStyle(body, style) {
  if (!style) return body;
  let out = body;
  if (style.usesContractions === false) out = expandContractions(out);
  if (style.energy === "upbeat") out = out.replace(/(^|\n)Thanks,/m, "$1Thanks so much,");
  return out;
}

export function generateDraftPreview(profile, door) {
  const company = door.companyName || "your company";
  const me = whoAmI(profile);
  const s = door.signals || {};
  const tone = TONES[profile.tone] || TONES["Sharp"];
  const style = profile.styleProfile || null;

  let subject, hook;
  if (s.founder) {
    subject = "quick founder question";
    hook = tone.founderHook(company, me);
  } else if (s.investor) {
    subject = `quick question on ${company}`;
    hook = tone.investorHook(company, me);
  } else if (s.hiring) {
    subject = `quick question on ${company}`;
    hook = tone.hiringHook(company);
  } else {
    subject = `quick question about ${company}`;
    hook = tone.defaultHook(company, me);
  }

  const win = firstWin(profile);
  const credibility = win ? tone.cred(win.replace(/^I\s+/i, "")) : tone.credFallback;
  const signoff = (profile.signoff || `- ${(profile.fullName || "Me").split(" ")[0]}`).replace(/^-\s*/, "");

  const body = applyStyle(
    `${tone.greeting(door.firstName || (door.name || "there").split(" ")[0])}\n\n${hook}\n\n${credibility}\n\n${tone.ask}\n\n${tone.close}\n${signoff}`,
    style
  );

  return { subject, preview: hook, body };
}
