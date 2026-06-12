/* Google Calendar — create events with a Meet link on the user's primary
   calendar, using the same oauth_connections tokens as Gmail (the connect
   flow already requests calendar.events). */

import { randomUUID } from "node:crypto";
import { getGoogleConnection, getAccessToken } from "../gmail/client.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const DEFAULT_TZ = "America/Los_Angeles";

function tzParts(date, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
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

    const response = await fetch(`${CALENDAR_API}?conferenceDataVersion=1&sendUpdates=none`, {
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
      htmlLink: data.htmlLink || null,
      start: data.start?.dateTime || event.start.dateTime,
    };
  } catch (err) {
    console.error("Calendar event create error:", err.message);
    return null;
  }
}
