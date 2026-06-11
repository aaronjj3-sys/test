/* Deterministic draft previews — no LLM key required for the MVP.
   Later this swaps to Claude with the same signature. */

function firstWin(profile) {
  const wins = profile.quantifiedWins || [];
  if (wins.length) return wins[0];
  /* pull a number-y phrase out of the story as a fallback */
  const m = (profile.story || "").match(/[^.]*\$?\d[\d,.]*[KkMm%+]?[^.]*/);
  return m ? m[0].trim() : null;
}

function whoAmI(profile) {
  const school = profile.school ? `${profile.school} student` : "student";
  const win = firstWin(profile);
  return win ? `a ${school} who ${win.replace(/^I\s+/i, "").replace(/^built/i, "built")}` : `a ${school}`;
}

export function generateDraftPreview(profile, door) {
  const company = door.companyName || "your company";
  const me = whoAmI(profile);
  const s = door.signals || {};

  let subject, hook, ask;
  if (s.founder) {
    subject = "quick founder question";
    hook = `Saw you're building at ${company} — I'm ${me}, and I'm trying to learn from founders operating at a much higher level.`;
    ask = "Would you be open to 15 minutes sometime in the next couple of weeks? Happy to work around your schedule.";
  } else if (s.investor) {
    subject = `quick question on ${company}`;
    hook = `I'm ${me}, looking to learn from investors who sit close to operators and early-stage company building.`;
    ask = "If you have 15 minutes in the next few weeks, I'd love to hear how you think about backing early teams.";
  } else if (s.hiring) {
    subject = `quick question on ${company}`;
    hook = `I saw ${company} has been hiring in areas close to my interests, and I wanted to reach out directly instead of dropping into an application portal.`;
    ask = "Would you be open to a quick chat about what you look for? I move fast and I'm easy to schedule.";
  } else {
    subject = `quick question about ${company}`;
    hook = `I came across your work at ${company} — I'm ${me}, and the path you've taken is close to the one I'm working toward.`;
    ask = "Would you be open to a 15-minute chat? Even a couple of pointers would mean a lot.";
  }

  const credibility = firstWin(profile)
    ? `For context: I ${firstWin(profile).replace(/^I\s+/i, "")} — so I show up prepared and I don't waste people's time.`
    : "I do my homework before I reach out, and I don't waste people's time.";

  return {
    subject,
    preview: hook,
    body: `Hi ${door.firstName || door.name.split(" ")[0]},\n\n${hook}\n\n${credibility}\n\n${ask}\n\nThanks,\n${profile.fullName || "Me"}`,
  };
}
