/* Google Calendar — create events with a Meet link on the user's primary
   calendar, using the same oauth_connections tokens as Gmail (the connect
   flow already requests calendar.events). */

import { randomUUID } from "node:crypto";
import { getGoogleConnection, getAccessToken } from "../gmail/client.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const FREEBUSY_API = "https://www.googleapis.com/calendar/v3/freeBusy";
export const DEFAULT_TZ = "America/Los_Angeles";

function tzParts(date, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
}

function tzDateTimeParts(date, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
}

function dayIsoFromUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysUtcDate(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function localDayAsUtcDate(date, tz) {
  const p = tzParts(date, tz);
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
}

function zonedDateTimeToDate(localIso, tz = DEFAULT_TZ) {
  const m = String(localIso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return new Date(localIso);
  const target = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6] || 0),
  };
  const guess = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  const got = tzDateTimeParts(new Date(guess), tz);
  const gotUtc = Date.UTC(Number(got.year), Number(got.month) - 1, Number(got.day), Number(got.hour), Number(got.minute), 0);
  const wantedUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  return new Date(guess + (wantedUtc - gotUtc));
}

function addMinutesLocal(localIso, minutes) {
  const m = String(localIso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return localIso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]) + minutes));
  return `${dayIsoFromUtcDate(d)}T${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:00`;
}

function rangeForText(text = "", tz = DEFAULT_TZ) {
  const lower = String(text || "").toLowerCase();
  const today = localDayAsUtcDate(new Date(), tz);
  const dow = today.getUTCDay();
  if (/\btoday\b/.test(lower)) return { start: today, end: addDaysUtcDate(today, 1) };
  if (/\btomorrow\b/.test(lower)) return { start: addDaysUtcDate(today, 1), end: addDaysUtcDate(today, 2) };
  if (/\bnext week\b/.test(lower)) {
    const daysUntilMonday = ((8 - dow) % 7) || 7;
    const start = addDaysUtcDate(today, daysUntilMonday);
    return { start, end: addDaysUtcDate(start, 5) };
  }
  if (/\bthis week\b/.test(lower)) {
    return { start: today, end: addDaysUtcDate(today, Math.max(1, 6 - dow)) };
  }
  return { start: addDaysUtcDate(today, 1), end: addDaysUtcDate(today, 10) };
}

/* Next weekday at 15:00 local time (offset-naive ISO + explicit timeZone),
   25 minutes long. Always tomorrow-or-later in the target timezone. */
export function nextBusinessSlot(tz = DEFAULT_TZ) {
  const today = tzParts(new Date(), tz);
  let t = Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day));
  for (let i = 0; i < 7; i++) {
    t += 24 * 60 * 60 * 1000; // next local calendar day
    const candidate = new Date(t);
    const dow = candidate.getUTCDay(); // weekday of a calendar date is tz-independent
    if (dow !== 0 && dow !== 6) {
      const day = candidate.toISOString().slice(0, 10);
      return {
        start: { dateTime: `${day}T15:00:00`, timeZone: tz },
        end: { dateTime: `${day}T15:25:00`, timeZone: tz },
      };
    }
  }
  return null;
}

function overlapsBusy(startDate, endDate, busy) {
  const start = startDate.getTime();
  const end = endDate.getTime();
  return busy.some((b) => {
    const bs = Date.parse(b.start);
    const be = Date.parse(b.end);
    return Number.isFinite(bs) && Number.isFinite(be) && start < be && end > bs;
  });
}

function optionLabel(startDate, tz) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(startDate);
}

export async function availabilityOptions({ userId, text = "", tz = DEFAULT_TZ, durationMinutes = 25, maxOptions = 3 } = {}) {
  const range = rangeForText(text, tz);
  const connection = await getGoogleConnection(userId);
  if (!connection) return [];
  const token = await getAccessToken(connection);
  const timeMin = zonedDateTimeToDate(`${dayIsoFromUtcDate(range.start)}T00:00:00`, tz).toISOString();
  const timeMax = zonedDateTimeToDate(`${dayIsoFromUtcDate(range.end)}T23:59:00`, tz).toISOString();
  let busy = [];
  try {
    const response = await fetch(FREEBUSY_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin, timeMax, timeZone: tz, items: [{ id: "primary" }] }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) busy = data.calendars?.primary?.busy || [];
  } catch (err) {
    console.error("Calendar freebusy failed:", err.message);
  }

  const options = [];
  const now = new Date();
  const localNow = tzDateTimeParts(now, tz);
  const slotTimes = ["09:30", "11:00", "14:00", "15:30"];
  for (let day = new Date(range.start); day <= range.end && options.length < maxOptions; day = addDaysUtcDate(day, 1)) {
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const date = dayIsoFromUtcDate(day);
    for (const hm of slotTimes) {
      if (options.length >= maxOptions) break;
      const localStart = `${date}T${hm}:00`;
      const startDate = zonedDateTimeToDate(localStart, tz);
      const endLocal = addMinutesLocal(localStart, durationMinutes);
      const endDate = zonedDateTimeToDate(endLocal, tz);
      if (startDate.getTime() < now.getTime() + 45 * 60 * 1000) continue;
      if (date === `${localNow.year}-${localNow.month}-${localNow.day}` && startDate <= now) continue;
      if (overlapsBusy(startDate, endDate, busy)) continue;
      options.push({
        label: optionLabel(startDate, tz),
        start: { dateTime: localStart, timeZone: tz },
        end: { dateTime: endLocal, timeZone: tz },
      });
    }
  }
  return options;
}

const WEEKDAYS = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

export function parseRequestedMeetingTime(text = "", { tz = DEFAULT_TZ, durationMinutes = 25 } = {}) {
  const lower = String(text || "").toLowerCase();
  const timeMatch =
    lower.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/) ||
    lower.match(/\bat\s+(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)?\b/);
  if (!timeMatch) return null;
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || 0);
  const ampm = timeMatch[3] || (hour >= 8 && hour <= 11 ? "am" : "pm");
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  const today = localDayAsUtcDate(new Date(), tz);
  let day = null;
  if (/\btomorrow\b/.test(lower)) day = addDaysUtcDate(today, 1);
  else if (/\btoday\b/.test(lower)) day = today;
  else {
    const dayHit = lower.match(/\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday|day)?|wed(?:nesday)?|thu(?:rs|rsday|rday)?|fri(?:day)?|sat(?:urday)?)\b/);
    if (dayHit) {
      const wanted = WEEKDAYS[dayHit[1]];
      const current = today.getUTCDay();
      let add = (wanted - current + 7) % 7;
      if (add === 0 || /\bnext week\b/.test(lower)) add += 7;
      day = addDaysUtcDate(today, add);
    }
  }
  if (!day) return null;
  const startLocal = `${dayIsoFromUtcDate(day)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  const startDate = zonedDateTimeToDate(startLocal, tz);
  if (startDate.getTime() < Date.now() - 10 * 60 * 1000) return null;
  const endLocal = addMinutesLocal(startLocal, durationMinutes);
  return {
    label: optionLabel(startDate, tz),
    start: { dateTime: startLocal, timeZone: tz },
    end: { dateTime: endLocal, timeZone: tz },
  };
}

function normalizeTime(value, tz) {
  if (!value) return null;
  if (typeof value === "string") return { dateTime: value, timeZone: tz };
  return value; // already { dateTime, timeZone }
}

export async function createMeetEvent({ userId, summary, description, start, end, attendeeEmail, tz = DEFAULT_TZ }) {
  try {
    const connection = await getGoogleConnection(userId);
    if (!connection) return null;
    const token = await getAccessToken(connection);

    const slot = !start || !end ? nextBusinessSlot(tz) : null;
    const event = {
      summary: summary || "Intro call",
      description: description || "",
      start: normalizeTime(start, tz) || slot.start,
      end: normalizeTime(end, tz) || slot.end,
      conferenceData: {
        createRequest: {
          requestId: randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    };
    if (attendeeEmail) event.attendees = [{ email: attendeeEmail }];

    const response = await fetch(`${CALENDAR_API}?conferenceDataVersion=1&sendUpdates=all`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Calendar event create failed:", response.status);
      return null;
    }

    const meetLink =
      data.hangoutLink ||
      data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ||
      null;

    return {
      eventId: data.id,
      meetLink,
      calendarLink: data.htmlLink || null,
      start: data.start?.dateTime || event.start.dateTime,
    };
  } catch (err) {
    console.error("Calendar event create error:", err.message);
    return null;
  }
}
