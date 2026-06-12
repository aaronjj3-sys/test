/* Door scoring: deterministic, transparent, capped 0–100, with human-readable reasons. */

const FOUNDER_RE = /\b(founder|co-?founder|ceo)\b/i;
const INVESTOR_RE = /\b(partner|investor|principal|managing director|gp\b|general partner)\b/i;
const TALENT_RE = /\b(recruit|talent|hiring|people|hr\b)\b/i;
const OPERATOR_RE = /\b(chief of staff|operations|growth|strategy|product|marketing)\b/i;

export function scoreDoor(door, profile = {}, filters = {}) {
  let score = 0;
  const reasons = [];
  const signals = door.signals || {};
  const title = (door.title || "").toLowerCase();
  const company = (door.companyName || "").toLowerCase();
  const haystack = `${title} ${company}`;

  if (FOUNDER_RE.test(title)) {
    score += 25;
    signals.founder = true;
    reasons.push("Founder match");
  } else if (INVESTOR_RE.test(title)) {
    score += 20;
    signals.investor = true;
    reasons.push("Investor title match");
  } else if (TALENT_RE.test(title)) {
    score += 18;
    signals.hiring = true;
    reasons.push("Hiring / talent role");
  } else if (OPERATOR_RE.test(title)) {
    score += 15;
    signals.operator = true;
    reasons.push("Operator role match");
  } else if (filters.allMode) {
    /* "all" mode has no persona restriction — a neutral baseline keeps
       unrestricted results from tanking just because no persona regex hit;
       the best-fitting persona bonus above still wins when a title matches */
    score += 12;
    reasons.push("Open search candidate");
  }

  /* profile-aware boosts: what the user said they're targeting */
  const roleWords = (profile.targetRoles || [])
    .flatMap((r) => String(r).toLowerCase().split(/[^a-z]+/))
    .filter((w) => w.length > 3)
    .map((w) => w.replace(/s$/, ""));
  if (roleWords.some((w) => title.includes(w))) {
    score += 8;
    signals.targetRole = true;
    reasons.push("Matches the roles you target");
  }
  const skillWords = (profile.skills || []).map((s) => String(s).toLowerCase()).filter((s) => s.length > 2);
  if (skillWords.some((s) => haystack.includes(s))) {
    score += 4;
    signals.skillOverlap = true;
    reasons.push("Overlaps with your skills");
  }

  const targetDomains = filters.companyDomains || [];
  const targetNames = (filters.companyNames || []).map((n) => n.toLowerCase());
  if (
    (door.companyDomain && targetDomains.includes(door.companyDomain)) ||
    targetNames.some((n) => company.includes(n))
  ) {
    score += 20;
    signals.targetCompany = true;
    reasons.push("Works at a target company");
  }

  const seniorities = filters.seniorities || [];
  if (door.seniority && seniorities.includes(door.seniority)) {
    score += 10;
    reasons.push("Strong seniority fit");
  }

  const industryWords = (profile.industries || []).map((i) => i.toLowerCase());
  if (industryWords.some((w) => haystack.includes(w))) {
    score += 10;
    signals.relevantIndustry = true;
    reasons.push("Relevant company context");
  }

  if (signals.activelyHiring) {
    score += 10;
    reasons.push("Hiring signal detected");
  }

  if (door.linkedinUrl) {
    score += 5;
    signals.hasLinkedIn = true;
    reasons.push("LinkedIn available for review");
  }
  if (door.email || (door.emailStatus && door.emailStatus === "verified")) {
    score += 5;
    signals.hasEmail = true;
  }

  /* alumni match when education data exists (only present after enrichment) */
  const school = (profile.school || "").toLowerCase();
  if (school && JSON.stringify(door.raw || {}).toLowerCase().includes(school)) {
    score += 15;
    signals.alumni = true;
    reasons.push(`Likely ${profile.school} alumni`);
  }

  /* story/goal resonance: founder story → founders/investors care */
  const story = `${profile.story || ""} ${profile.target || ""}`.toLowerCase();
  if ((signals.founder || signals.investor) && /\b(built|founder|business|started|launched)\b/.test(story)) {
    score += 10;
    reasons.push("Strong fit for your founder story");
  }

  /* penalize when nothing matched at all */
  if (reasons.length === 0) score -= 15;

  door.matchScore = Math.max(0, Math.min(100, score));
  door.matchReasons = reasons.slice(0, 4);
  door.signals = signals;
  return door;
}

export const rankDoors = (doors, profile, filters) =>
  doors
    .map((d) => scoreDoor(d, profile, filters))
    .sort((a, b) => b.matchScore - a.matchScore);
