import { ReplitConnectors } from "@replit/connectors-sdk";
import { cell, dataRows, headerIndex, headersFor, KimeuError, readTab } from "./sheets";
import { classifyWorkshop } from "./calendar-matching";
import { isPostgresMode } from "./db/env";
import { readCatalog } from "./db/catalog";
import { withRead } from "./db/transaction";

type CalendarTime = { date?: string; dateTime?: string };
type CalendarEvent = {
  id?: string; summary?: string; start?: CalendarTime; end?: CalendarTime;
  location?: string; status?: string; htmlLink?: string;
};
type CalendarPage = { items?: CalendarEvent[]; nextPageToken?: string };
const connectors = new ReplitConnectors();

export async function getCalendarCatalog() {
  if (isPostgresMode()) {
    return withRead(async sql => (await readCatalog(sql)).map(course => ({
      id: course.workshopId, name: course.name, stage: course.stage,
    })));
  }
  const catalogTab = await readTab("03a-KIMEU Workshops");
  const headers = headersFor(catalogTab);
  const idColumn = headerIndex(headers, "Workshop ID");
  const nameColumn = headerIndex(headers, "Workshop Name");
  const stageColumn = headerIndex(headers, "Stage");
  return dataRows(catalogTab).map((row) => ({
    id: cell(row.values, idColumn), name: cell(row.values, nameColumn), stage: cell(row.values, stageColumn),
  })).filter((item) => item.id && item.name);
}

export async function getUpcomingWorkshops() {
  const calendarId = process.env.KIMEU_CALENDAR_ID;
  if (!calendarId) throw new KimeuError("The KIMEU schedule calendar has not been selected.", 503, "CALENDAR_NOT_CONFIGURED");
  const catalog = await getCalendarCatalog();
  const now = new Date();
  const until = new Date(now);
  until.setUTCFullYear(until.getUTCFullYear() + 1);
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      timeMin: now.toISOString(), timeMax: until.toISOString(),
      singleEvents: "true", orderBy: "startTime", showDeleted: "true", maxResults: "250",
      // Explicitly exclude attendees, organizer, description and RSVP data.
      fields: "items(id,summary,start,end,location,status,htmlLink),nextPageToken",
    });
    if (pageToken) query.set("pageToken", pageToken);
    try {
      const response = await connectors.proxy("google-calendar",
        `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query}`, { method: "GET" });
      if (!response.ok) throw new Error(`Calendar returned ${response.status}`);
      const page = await response.json() as CalendarPage;
      events.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } catch {
      throw new KimeuError("The KIMEU Calendar could not be refreshed. Check the Google Calendar connection and try again. Attendance records have not changed.", 503, "CALENDAR_UNAVAILABLE");
    }
  } while (pageToken);
  const occurrences = events.flatMap((event) => {
    const title = event.summary ?? "";
    const match = classifyWorkshop(title, catalog);
    const start = event.start?.dateTime ?? event.start?.date;
    const end = event.end?.dateTime ?? event.end?.date;
    if (!event.id || !start || !end || !match.include) return [];
    return [{
      // Google keeps this ID stable for rescheduling, including recurring instances.
      occurrenceId: `${calendarId}:${event.id}`,
      title, start, end, allDay: Boolean(event.start?.date),
      location: event.location ?? null,
      status: event.status === "cancelled" ? "cancelled" as const : event.status === "tentative" ? "tentative" as const : "confirmed" as const,
      calendarUrl: event.htmlLink?.startsWith("https://www.google.com/calendar/") ||
        event.htmlLink?.startsWith("https://calendar.google.com/") ? event.htmlLink : null,
      workshopId: match.workshop?.id ?? null,
      stage: match.workshop ? (/foundations/i.test(match.workshop.stage) ? "Foundations" : "Advanced") : null,
    }];
  });
  return { calendarName: "KIMEU Calendar", refreshedAt: new Date().toISOString(), throughDate: until.toISOString(), occurrences };
}
