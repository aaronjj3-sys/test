/* Door scoring: deterministic, transparent, capped 0–100, with human-readable reasons. */

const FOUNDER_RE = /\b(founder|co-?founder|ceo)\b/i;
const INVESTOR_RE = /\b(partner|investor|principal|managing director|gp\b|general partner)\b/i;
const TALENT_RE = /\b(recruit|talent|hiring|people|hr\b)\b/i;

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
