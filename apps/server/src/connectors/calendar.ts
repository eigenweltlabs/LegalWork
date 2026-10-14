import { z } from "zod";
import { ApiError } from "../errors.js";
import type { ConnectorRequest } from "./request.js";
import { accountInput, nativeId, nativePagePath, parseNative } from "./native.js";

export const calendarListInput = accountInput.extend({ maxResults: z.number().int().min(1).max(50).default(25), pageToken: z.string().max(8192).optional() }).strict();
const calendarAccount = accountInput.extend({ calendarId: nativeId.default("primary") });
export const calendarEventsInput = calendarAccount.extend({
  timeMin: z.iso.datetime({ offset: true }), timeMax: z.iso.datetime({ offset: true }),
  maxResults: z.number().int().min(1).max(100).default(25), pageToken: z.string().max(8192).optional(),
}).strict().refine((value) => Date.parse(value.timeMax) > Date.parse(value.timeMin), "The end must be after the start.");
export const calendarEventInput = calendarAccount.extend({ eventId: nativeId }).strict();
export const calendarCreateInput = calendarAccount.extend({
  title: z.string().trim().min(1).max(500), description: z.string().max(20_000).optional(), location: z.string().max(1000).optional(),
  start: z.union([z.iso.date(), z.iso.datetime({ offset: true })]), end: z.union([z.iso.date(), z.iso.datetime({ offset: true })]),
  allDay: z.boolean().default(false),
  timeZone: z.string().max(100).optional(), reminders: z.array(z.number().int().min(0).max(40320)).max(20).optional(),
}).strict().refine((value) => {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  return dateOnly.test(value.start) === value.allDay && dateOnly.test(value.end) === value.allDay && Date.parse(value.end) > Date.parse(value.start);
}, "Use dates for all-day events, offset timestamps for timed events, and an end after the start.");

const googleDate = z.object({ date: z.string().optional(), dateTime: z.string().optional(), timeZone: z.string().optional() });
const googleEvent = z.object({ id: z.string(), summary: z.string().optional(), description: z.string().optional(), location: z.string().optional(),
  start: googleDate.optional(), end: googleDate.optional(), status: z.string().optional(), htmlLink: z.string().optional(),
});
const outlookDate = z.object({ dateTime: z.string(), timeZone: z.string() });
const outlookEvent = z.object({ id: z.string(), subject: z.string().nullish(), body: z.object({ content: z.string(), contentType: z.string() }).nullish(),
  start: outlookDate, end: outlookDate, isAllDay: z.boolean().optional(), isCancelled: z.boolean().optional(),
  location: z.object({ displayName: z.string().optional() }).nullish(), webLink: z.string().optional(),
});

function googleSummary(event: z.infer<typeof googleEvent>) {
  return { id: event.id, title: event.summary ?? "", description: event.description ?? "", location: event.location ?? "",
    start: event.start?.dateTime ?? event.start?.date ?? null, end: event.end?.dateTime ?? event.end?.date ?? null,
    timeZone: event.start?.timeZone ?? null, allDay: Boolean(event.start?.date), status: event.status ?? "confirmed", webUrl: event.htmlLink ?? null };
}
function outlookSummary(event: z.infer<typeof outlookEvent>) {
  return { id: event.id, title: event.subject ?? "", description: event.body?.content ?? "", descriptionType: event.body?.contentType ?? "text",
    location: event.location?.displayName ?? "", start: event.start.dateTime, end: event.end.dateTime,
    timeZone: event.start.timeZone, endTimeZone: event.end.timeZone, allDay: event.isAllDay ?? false,
    status: event.isCancelled ? "cancelled" : "confirmed", webUrl: event.webLink ?? null };
}
function googleEventsPath(calendarId: string) { return `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`; }
function outlookCalendarPath(calendarId: string) { return calendarId === "primary" ? "/v1.0/me/calendar" : `/v1.0/me/calendars/${encodeURIComponent(calendarId)}`; }

export const googleCalendarAdapter = {
  async test(request: ConnectorRequest) {
    parseNative(z.object({ items: z.array(z.object({ id: z.string() })).default([]) }), await request("/calendar/v3/users/me/calendarList?maxResults=1&fields=items(id)"));
    return { ok: true };
  },
  async calendars(request: ConnectorRequest, input: z.infer<typeof calendarListInput>) {
    const query = new URLSearchParams({ maxResults: String(input.maxResults) });
    if (input.pageToken) query.set("pageToken", input.pageToken);
    const page = parseNative(z.object({ items: z.array(z.object({ id: z.string(), summary: z.string().optional(), timeZone: z.string().optional(), accessRole: z.string().optional(), primary: z.boolean().optional() })).default([]), nextPageToken: z.string().optional() }),
      await request(`/calendar/v3/users/me/calendarList?${query}`));
    return { calendars: page.items.map((item) => ({ id: item.id, name: item.summary ?? "", timeZone: item.timeZone ?? null, canWrite: item.accessRole === "owner" || item.accessRole === "writer", primary: item.primary ?? false })), nextPageToken: page.nextPageToken ?? null };
  },
  async events(request: ConnectorRequest, input: z.infer<typeof calendarEventsInput>) {
    const query = new URLSearchParams({ timeMin: input.timeMin, timeMax: input.timeMax, maxResults: String(input.maxResults), singleEvents: "true", orderBy: "startTime" });
    if (input.pageToken) query.set("pageToken", input.pageToken);
    const page = parseNative(z.object({ items: z.array(googleEvent).default([]), nextPageToken: z.string().optional(), timeZone: z.string().optional() }),
      await request(`${googleEventsPath(input.calendarId)}?${query}`));
    return { events: page.items.map(googleSummary), timeZone: page.timeZone ?? null, nextPageToken: page.nextPageToken ?? null };
  },
  async get(request: ConnectorRequest, input: z.infer<typeof calendarEventInput>) {
    return googleSummary(parseNative(googleEvent, await request(`${googleEventsPath(input.calendarId)}/${encodeURIComponent(input.eventId)}`)));
  },
  async create(request: ConnectorRequest, input: z.infer<typeof calendarCreateInput>) {
    const date = (value: string) => input.allDay ? { date: value } : { dateTime: value, ...(input.timeZone ? { timeZone: input.timeZone } : {}) };
    return googleSummary(parseNative(googleEvent, await request(`${googleEventsPath(input.calendarId)}?sendUpdates=none`, { method: "POST", body: {
      summary: input.title, description: input.description, location: input.location, start: date(input.start), end: date(input.end),
      ...(input.reminders ? { reminders: { useDefault: false, overrides: input.reminders.map(minutes => ({ method: "popup", minutes })) } } : {}),
    } })));
  },
};

export const outlookCalendarAdapter = {
  async test(request: ConnectorRequest) {
    parseNative(z.object({ value: z.array(z.object({ id: z.string() })) }), await request("/v1.0/me/calendars?$top=1&$select=id"));
    return { ok: true };
  },
  async calendars(request: ConnectorRequest, input: z.infer<typeof calendarListInput>) {
    const path = "/v1.0/me/calendars";
    const query = new URLSearchParams({ "$top": String(input.maxResults), "$select": "id,name,canEdit,isDefaultCalendar" });
    const page = parseNative(z.object({ value: z.array(z.object({ id: z.string(), name: z.string(), canEdit: z.boolean().optional(), isDefaultCalendar: z.boolean().optional() })), "@odata.nextLink": z.string().optional() }),
      await request(input.pageToken ? nativePagePath(input.pageToken, "https://graph.microsoft.com", path) : `${path}?${query}`));
    if (page["@odata.nextLink"]) nativePagePath(page["@odata.nextLink"], "https://graph.microsoft.com", path);
    return { calendars: page.value.map((item) => ({ id: item.id, name: item.name, canWrite: item.canEdit ?? false, primary: item.isDefaultCalendar ?? false })), nextPageToken: page["@odata.nextLink"] ?? null };
  },
  async events(request: ConnectorRequest, input: z.infer<typeof calendarEventsInput>) {
    const path = `${outlookCalendarPath(input.calendarId)}/calendarView`;
    const query = new URLSearchParams({ startDateTime: input.timeMin, endDateTime: input.timeMax, "$top": String(input.maxResults), "$orderby": "start/dateTime" });
    const page = parseNative(z.object({ value: z.array(outlookEvent), "@odata.nextLink": z.string().optional() }),
      await request(input.pageToken ? nativePagePath(input.pageToken, "https://graph.microsoft.com", path) : `${path}?${query}`, { headers: { Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"' } }));
    if (page["@odata.nextLink"]) nativePagePath(page["@odata.nextLink"], "https://graph.microsoft.com", path);
    return { events: page.value.map(outlookSummary), nextPageToken: page["@odata.nextLink"] ?? null };
  },
  async get(request: ConnectorRequest, input: z.infer<typeof calendarEventInput>) {
    return outlookSummary(parseNative(outlookEvent, await request(`${outlookCalendarPath(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`, { headers: { Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"' } })));
  },
  async create(request: ConnectorRequest, input: z.infer<typeof calendarCreateInput>) {
    if (input.reminders && input.reminders.length > 1) throw new ApiError(400, "connector_calendar_reminders", "Outlook supports one reminder per event.");
    const date = (value: string) => ({ dateTime: input.allDay ? `${value}T00:00:00` : new Date(value).toISOString().replace(/Z$/, ""), timeZone: input.allDay ? input.timeZone ?? "UTC" : "UTC" });
    return outlookSummary(parseNative(outlookEvent, await request(`${outlookCalendarPath(input.calendarId)}/events`, { method: "POST", body: {
      subject: input.title, body: { contentType: "Text", content: input.description ?? "" }, location: { displayName: input.location ?? "" },
      start: date(input.start), end: date(input.end), isAllDay: input.allDay, attendees: [],
      ...(input.reminders ? { isReminderOn: input.reminders.length > 0, reminderMinutesBeforeStart: input.reminders[0] ?? 0 } : {}),
    } })));
  },
};
