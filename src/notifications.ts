import express from "express";
import { z } from "zod";
import { cert, getApps, initializeApp, type App as FirebaseApp } from "firebase-admin/app";
import { getMessaging, type Message } from "firebase-admin/messaging";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { AppError, assert } from "./errors.js";
import { requireAuth, requireRole } from "./middleware.js";
import { ensureInvoices } from "./rent.js";
import { money, monthName } from "./utils.js";

const MAX_CAMPAIGN_DAYS = 30;
const MAX_SENDS_PER_DAY = 3;
const QUIET_START_MINUTES = 8 * 60;
const QUIET_END_MINUTES = 22 * 60;
const SCHEDULER_INTERVAL_MS = 60_000;
const MAX_BATCH = 500;

const audienceSchema = z.enum(["ALL", "PENDING", "OVERDUE", "SELECTED"]);
const campaignActionSchema = z.enum(["PAUSE", "RESUME", "CANCEL"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

const messageSchema = z.object({
  title: z.string().trim().min(2).max(80),
  body: z.string().trim().min(2).max(240),
  audienceType: audienceSchema,
  selectedStudentIds: z.array(z.string().min(1)).max(500).optional().default([]),
  financialYear: z.coerce.number().int().min(2020).max(2100).optional(),
  financialMonth: z.coerce.number().int().min(1).max(12).optional()
});

const scheduleSchema = messageSchema.extend({
  startDate: dateSchema,
  endDate: dateSchema,
  scheduleTimes: z.array(timeSchema).min(1).max(MAX_SENDS_PER_DAY)
});

const registerDeviceSchema = z.object({
  installationId: z.string().trim().min(8).max(500),
  platform: z.enum(["ANDROID"]).default("ANDROID"),
  appVersion: z.string().trim().max(40).optional()
});

function firebaseClientConfig() {
  const values = [config.FIREBASE_PROJECT_ID, config.FIREBASE_ANDROID_APP_ID, config.FIREBASE_ANDROID_API_KEY, config.FIREBASE_SENDER_ID];
  if (values.some((value) => !value)) return null;
  return {
    projectId: config.FIREBASE_PROJECT_ID!,
    applicationId: config.FIREBASE_ANDROID_APP_ID!,
    apiKey: config.FIREBASE_ANDROID_API_KEY!,
    senderId: config.FIREBASE_SENDER_ID!
  };
}

let firebaseApp: FirebaseApp | null | undefined;
function getFirebaseAdminApp(): FirebaseApp | null {
  if (firebaseApp !== undefined) return firebaseApp;
  if (!config.FIREBASE_PROJECT_ID || !config.FIREBASE_SERVICE_ACCOUNT_JSON) {
    firebaseApp = null;
    return null;
  }
  try {
    const existing = getApps().find((app) => app.name === "safehouse-notifications");
    if (existing) {
      firebaseApp = existing;
      return existing;
    }
    let raw = config.FIREBASE_SERVICE_ACCOUNT_JSON.trim();
    if (!raw.startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8");
    const serviceAccount = JSON.parse(raw);
    firebaseApp = initializeApp({ credential: cert(serviceAccount), projectId: config.FIREBASE_PROJECT_ID }, "safehouse-notifications");
    return firebaseApp;
  } catch (error) {
    console.error("SafeHouse Firebase Admin initialization failed", error);
    firebaseApp = null;
    return null;
  }
}

function serverPushReady() { return !!getFirebaseAdminApp(); }
function requirePushReady() { assert(serverPushReady(), 503, "PUSH_NOT_CONFIGURED", "Push notifications are not configured on the server yet"); }

export const notificationRouter = express.Router();
notificationRouter.use(requireAuth);
notificationRouter.get("/config", (_req, res) => {
  const client = firebaseClientConfig();
  res.json({ clientEnabled: !!client, serverEnabled: serverPushReady(), firebase: client });
});
notificationRouter.post("/devices/register", async (req, res) => {
  const input = registerDeviceSchema.parse(req.body);
  const device = await prisma.deviceRegistration.upsert({
    where: { installationId: input.installationId },
    update: { userId: req.authUser!.id, platform: input.platform, appVersion: input.appVersion || null, enabled: true, lastSeenAt: new Date() },
    create: { userId: req.authUser!.id, installationId: input.installationId, platform: input.platform, appVersion: input.appVersion || null, enabled: true, lastSeenAt: new Date() }
  });
  res.json({ ok: true, device: { id: device.id, enabled: device.enabled, lastSeenAt: device.lastSeenAt } });
});
notificationRouter.post("/devices/unregister", async (req, res) => {
  const { installationId } = z.object({ installationId: z.string().trim().min(8).max(500) }).parse(req.body);
  await prisma.deviceRegistration.updateMany({ where: { installationId, userId: req.authUser!.id }, data: { enabled: false, lastSeenAt: new Date() } });
  res.json({ ok: true });
});

export const ownerNotificationRouter = express.Router();
ownerNotificationRouter.use(requireRole("OWNER" as any));
ownerNotificationRouter.get("/campaigns", async (req, res) => {
  const property = await resolveOwnerProperty(req.authUser!.id, req);
  const campaigns = await prisma.notificationCampaign.findMany({ where: { propertyId: property.id }, orderBy: { createdAt: "desc" }, take: 50 });
  const ids = campaigns.map((row) => row.id);
  const grouped = ids.length ? await prisma.notificationDelivery.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: ids } }, _count: { _all: true } }) : [];
  const counts = new Map<string, Record<string, number>>();
  for (const row of grouped) {
    const current = counts.get(row.campaignId) || {};
    current[row.status] = row._count._all;
    counts.set(row.campaignId, current);
  }
  res.json({ property: propertyDto(property), campaigns: campaigns.map((campaign) => campaignDto(campaign, counts.get(campaign.id) || {})), limits: { maxPerDay: MAX_SENDS_PER_DAY, quietHours: "08:00–22:00", maxCampaignDays: MAX_CAMPAIGN_DAYS } });
});

ownerNotificationRouter.post("/send-now", async (req, res) => {
  requirePushReady();
  const property = await resolveOwnerProperty(req.authUser!.id, req);
  const input = messageSchema.parse(req.body);
  validateAudience(input);
  const now = new Date();
  const campaign = await prisma.notificationCampaign.create({
    data: { propertyId: property.id, createdByUserId: req.authUser!.id, title: input.title, body: input.body, audienceType: input.audienceType, selectedStudentIds: input.selectedStudentIds, financialYear: input.financialYear || null, financialMonth: input.financialMonth || null, scheduleType: "IMMEDIATE", scheduleTimes: [], startDate: localDateString(now, property.timezone), endDate: localDateString(now, property.timezone), timezone: property.timezone, status: "ACTIVE", nextRunAt: now }
  });
  const summary = await dispatchCampaignOccurrence(campaign.id, now, `immediate:${campaign.id}`);
  await prisma.notificationCampaign.update({ where: { id: campaign.id }, data: { status: "COMPLETED", nextRunAt: null, lastRunAt: new Date() } });
  res.status(201).json({ campaignId: campaign.id, ...summary });
});

ownerNotificationRouter.post("/campaigns", async (req, res) => {
  requirePushReady();
  const property = await resolveOwnerProperty(req.authUser!.id, req);
  const input = scheduleSchema.parse(req.body);
  validateAudience(input);
  validateDateRange(input.startDate, input.endDate);
  const scheduleTimes = uniqueSortedTimes(input.scheduleTimes);
  for (const time of scheduleTimes) validateScheduleTime(time);
  const nextRunAt = findNextScheduledRun(input.startDate, input.endDate, scheduleTimes, property.timezone, new Date());
  assert(nextRunAt, 400, "NO_FUTURE_SCHEDULE", "The selected schedule has no future send time");
  const campaign = await prisma.notificationCampaign.create({
    data: { propertyId: property.id, createdByUserId: req.authUser!.id, title: input.title, body: input.body, audienceType: input.audienceType, selectedStudentIds: input.selectedStudentIds, financialYear: input.financialYear || null, financialMonth: input.financialMonth || null, scheduleType: "SCHEDULED", scheduleTimes, startDate: input.startDate, endDate: input.endDate, timezone: property.timezone, status: "ACTIVE", nextRunAt }
  });
  res.status(201).json({ campaign: campaignDto(campaign, {}) });
});

ownerNotificationRouter.patch("/campaigns/:id", async (req, res) => {
  const property = await resolveOwnerProperty(req.authUser!.id, req);
  const { action } = z.object({ action: campaignActionSchema }).parse(req.body);
  const campaign = await prisma.notificationCampaign.findFirst({ where: { id: req.params.id, propertyId: property.id } });
  assert(campaign, 404, "CAMPAIGN_NOT_FOUND", "Notification campaign not found");
  if (campaign.status === "COMPLETED" || campaign.status === "CANCELLED") throw new AppError(409, "CAMPAIGN_FINISHED", "This campaign has already finished");
  if (action === "PAUSE") {
    const updated = await prisma.notificationCampaign.update({ where: { id: campaign.id }, data: { status: "PAUSED", nextRunAt: null } });
    return res.json({ campaign: campaignDto(updated, {}) });
  }
  if (action === "CANCEL") {
    const updated = await prisma.notificationCampaign.update({ where: { id: campaign.id }, data: { status: "CANCELLED", nextRunAt: null } });
    return res.json({ campaign: campaignDto(updated, {}) });
  }
  const times = parseStringArray(campaign.scheduleTimes);
  const nextRunAt = findNextScheduledRun(campaign.startDate, campaign.endDate, times, campaign.timezone, new Date());
  assert(nextRunAt, 409, "CAMPAIGN_EXPIRED", "This campaign has no future send time");
  const updated = await prisma.notificationCampaign.update({ where: { id: campaign.id }, data: { status: "ACTIVE", nextRunAt } });
  return res.json({ campaign: campaignDto(updated, {}) });
});

export function startNotificationScheduler() {
  if (!serverPushReady()) {
    console.log("SafeHouse notification scheduler disabled: Firebase server credentials are not configured");
    return () => {};
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await dispatchDueCampaigns(); } catch (error) { console.error("SafeHouse notification scheduler tick failed", error); } finally { running = false; }
  };
  const startupTimer = setTimeout(() => void tick(), 8_000);
  const interval = setInterval(() => void tick(), SCHEDULER_INTERVAL_MS);
  console.log("SafeHouse notification scheduler active in API process");
  return () => { clearTimeout(startupTimer); clearInterval(interval); };
}

export async function notifyPaymentCaptured(invoiceId: string) {
  if (!serverPushReady()) return;
  const invoice = await prisma.rentInvoice.findUnique({ where: { id: invoiceId }, include: { property: true, student: { include: { user: true, room: true } } } });
  if (!invoice || invoice.status !== "PAID") return;
  const devices = await prisma.deviceRegistration.findMany({ where: { userId: invoice.student.userId, enabled: true } });
  if (!devices.length) return;
  const title = "Payment successful ✅";
  const body = `${money(invoice.totalPaise)} ${monthName(invoice.month)} rent received. You're sorted.`;
  await sendToDevices(devices, () => ({ title, body, route: "history", channel: "payments", data: { invoiceId: invoice.id } }));
}

async function dispatchDueCampaigns() {
  const now = new Date();
  const due = await prisma.notificationCampaign.findMany({ where: { status: "ACTIVE", scheduleType: "SCHEDULED", nextRunAt: { lte: now } }, orderBy: { nextRunAt: "asc" }, take: 20 });
  for (const campaign of due) {
    const occurrence = campaign.nextRunAt || now;
    const occurrenceKey = occurrence.toISOString();
    try { await dispatchCampaignOccurrence(campaign.id, occurrence, occurrenceKey); } catch (error) { console.error(`SafeHouse campaign ${campaign.id} dispatch failed`, error); }
    const fresh = await prisma.notificationCampaign.findUnique({ where: { id: campaign.id } });
    if (!fresh || fresh.status !== "ACTIVE") continue;
    const times = parseStringArray(fresh.scheduleTimes);
    const next = findNextScheduledRun(fresh.startDate, fresh.endDate, times, fresh.timezone, new Date(Math.max(Date.now(), occurrence.getTime() + 1_000)));
    await prisma.notificationCampaign.update({ where: { id: fresh.id }, data: { lastRunAt: new Date(), nextRunAt: next, status: next ? "ACTIVE" : "COMPLETED" } });
  }
}

type DeliverySummary = { eligible: number; devices: number; sent: number; failed: number; skippedLimit: number; skippedNoDevice: number };
async function dispatchCampaignOccurrence(campaignId: string, occurrenceAt: Date, occurrenceKey: string): Promise<DeliverySummary> {
  requirePushReady();
  const campaign = await prisma.notificationCampaign.findUnique({ where: { id: campaignId }, include: { property: true } });
  assert(campaign, 404, "CAMPAIGN_NOT_FOUND", "Notification campaign not found");
  const students = await resolveAudience(campaign);
  const summary: DeliverySummary = { eligible: students.length, devices: 0, sent: 0, failed: 0, skippedLimit: 0, skippedNoDevice: 0 };
  if (!students.length) return summary;
  const userIds = students.map((student) => student.userId);
  const devices = await prisma.deviceRegistration.findMany({ where: { userId: { in: userIds }, enabled: true } });
  const devicesByUser = new Map<string, typeof devices>();
  for (const device of devices) { const arr = devicesByUser.get(device.userId) || []; arr.push(device); devicesByUser.set(device.userId, arr); }
  summary.devices = devices.length;
  const windowStart = new Date(occurrenceAt.getTime() - 24 * 60 * 60 * 1000);
  const recentOccurrences = await prisma.notificationDelivery.findMany({ where: { userId: { in: userIds }, status: "SENT", sentAt: { gte: windowStart } }, select: { userId: true, occurrenceKey: true }, distinct: ["userId", "occurrenceKey"] });
  const sentCountByUser = new Map<string, number>();
  for (const row of recentOccurrences) sentCountByUser.set(row.userId, (sentCountByUser.get(row.userId) || 0) + 1);
  const messages: Message[] = [];
  const records: Array<{ deliveryId: string; installationId: string }> = [];
  for (const student of students) {
    const userDevices = devicesByUser.get(student.userId) || [];
    if (!userDevices.length) { summary.skippedNoDevice++; continue; }
    if ((sentCountByUser.get(student.userId) || 0) >= MAX_SENDS_PER_DAY) {
      summary.skippedLimit += userDevices.length;
      for (const device of userDevices) await createSkippedDelivery(campaign.id, student.userId, device.installationId, occurrenceKey, "SKIPPED_LIMIT");
      continue;
    }
    const template = templateContext(campaign.property.name, student, campaign.financialYear, campaign.financialMonth);
    const title = renderTemplate(campaign.title, template);
    const body = renderTemplate(campaign.body, template);
    for (const device of userDevices) {
      let delivery;
      try {
        delivery = await prisma.notificationDelivery.create({ data: { campaignId: campaign.id, userId: student.userId, installationId: device.installationId, occurrenceKey, status: "PENDING" } });
      } catch (error: any) { if (error?.code === "P2002") continue; throw error; }
      messages.push(buildMessage(device.installationId, title, body, campaign.audienceType === "ALL" ? "general" : "rent", "studentHome", { campaignId: campaign.id, financialYear: campaign.financialYear ? String(campaign.financialYear) : "", financialMonth: campaign.financialMonth ? String(campaign.financialMonth) : "" }));
      records.push({ deliveryId: delivery.id, installationId: device.installationId });
    }
  }
  for (let offset = 0; offset < messages.length; offset += MAX_BATCH) {
    const batchMessages = messages.slice(offset, offset + MAX_BATCH);
    const batchRecords = records.slice(offset, offset + MAX_BATCH);
    const response = await getMessaging(getFirebaseAdminApp()!).sendEach(batchMessages);
    for (let index = 0; index < response.responses.length; index++) {
      const result = response.responses[index]!;
      const record = batchRecords[index]!;
      if (result.success) {
        summary.sent++;
        await prisma.notificationDelivery.update({ where: { id: record.deliveryId }, data: { status: "SENT", sentAt: new Date(), providerMessageId: result.messageId || null } });
      } else {
        summary.failed++;
        const code = firebaseErrorCode(result.error);
        await prisma.notificationDelivery.update({ where: { id: record.deliveryId }, data: { status: "FAILED", errorCode: code } });
        if (isDeadInstallation(code)) await prisma.deviceRegistration.updateMany({ where: { installationId: record.installationId }, data: { enabled: false } });
      }
    }
  }
  return summary;
}

async function resolveAudience(campaign: any) {
  const selected = parseStringArray(campaign.selectedStudentIds);
  const needsPeriod = !!campaign.financialYear && !!campaign.financialMonth;
  if ((campaign.audienceType === "PENDING" || campaign.audienceType === "OVERDUE") && !needsPeriod) throw new AppError(400, "FINANCIAL_PERIOD_REQUIRED", "Pending and overdue audiences require a selected month");
  if (needsPeriod) await ensureInvoices(campaign.propertyId, campaign.financialYear, campaign.financialMonth);
  const now = Date.now();
  const students = await prisma.student.findMany({
    where: { propertyId: campaign.propertyId, status: "ACTIVE", ...(campaign.audienceType === "SELECTED" ? { id: { in: selected } } : {}) },
    include: { user: { select: { id: true, fullName: true } }, room: { select: { number: true } }, invoices: needsPeriod ? { where: { year: campaign.financialYear, month: campaign.financialMonth }, take: 1 } : { where: { id: "__none__" }, take: 1 } },
    orderBy: { user: { fullName: "asc" } }
  });
  return students.filter((student) => {
    if (campaign.audienceType === "ALL" || campaign.audienceType === "SELECTED") return true;
    const invoice = student.invoices[0];
    if (!invoice) return false;
    const unpaid = invoice.status === "DUE" && invoice.paidPaise < invoice.totalPaise;
    if (!unpaid) return false;
    return campaign.audienceType !== "OVERDUE" || invoice.dueDate.getTime() < now;
  }).map((student) => ({ ...student, userId: student.userId }));
}

async function sendToDevices(devices: Array<{ installationId: string }>, messageFor: () => { title: string; body: string; route: string; channel: string; data?: Record<string, string> }) {
  const payload = messageFor();
  const messages = devices.map((device) => buildMessage(device.installationId, payload.title, payload.body, payload.channel, payload.route, payload.data || {}));
  for (let offset = 0; offset < messages.length; offset += MAX_BATCH) {
    const batch = messages.slice(offset, offset + MAX_BATCH);
    const batchDevices = devices.slice(offset, offset + MAX_BATCH);
    const response = await getMessaging(getFirebaseAdminApp()!).sendEach(batch);
    for (let index = 0; index < response.responses.length; index++) {
      const item = response.responses[index]!;
      if (!item.success) { const code = firebaseErrorCode(item.error); if (isDeadInstallation(code)) await prisma.deviceRegistration.updateMany({ where: { installationId: batchDevices[index]!.installationId }, data: { enabled: false } }); }
    }
  }
}

function buildMessage(fid: string, title: string, body: string, channel: string, route: string, extra: Record<string, string>): Message {
  return { fid, data: { title, body, channel, route, ...extra }, android: { priority: "high", ttl: 24 * 60 * 60 * 1000 } };
}
async function createSkippedDelivery(campaignId: string, userId: string, installationId: string, occurrenceKey: string, status: string) {
  try { await prisma.notificationDelivery.create({ data: { campaignId, userId, installationId, occurrenceKey, status } }); } catch (error: any) { if (error?.code !== "P2002") throw error; }
}
function templateContext(propertyName: string, student: any, year?: number | null, month?: number | null) {
  const invoice = student.invoices?.[0];
  const remainingPaise = invoice ? Math.max(0, invoice.totalPaise - invoice.paidPaise) : 0;
  const daysOverdue = invoice ? Math.max(0, Math.floor((Date.now() - invoice.dueDate.getTime()) / 86_400_000)) : 0;
  const dueDate = invoice ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(invoice.dueDate) : "";
  return { name: student.user.fullName, property: propertyName, room: student.room?.number || "", month: month && year ? `${monthName(month)} ${year}` : "", amount: invoice ? money(remainingPaise) : "", due_date: dueDate, days_overdue: String(daysOverdue) };
}
function renderTemplate(value: string, context: Record<string, string>) { return value.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_match, key: string) => context[key.toLowerCase()] ?? "").replace(/\s{2,}/g, " ").trim(); }
function validateAudience(input: { audienceType: string; selectedStudentIds?: string[]; financialYear?: number; financialMonth?: number }) {
  if (input.audienceType === "SELECTED") assert(input.selectedStudentIds?.length, 400, "STUDENTS_REQUIRED", "Select at least one resident");
  if (input.audienceType === "PENDING" || input.audienceType === "OVERDUE") assert(input.financialYear && input.financialMonth, 400, "FINANCIAL_PERIOD_REQUIRED", "Select a rent month for this audience");
}
function validateDateRange(start: string, end: string) {
  const startMs = Date.parse(`${start}T00:00:00Z`), endMs = Date.parse(`${end}T00:00:00Z`);
  assert(Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs, 400, "INVALID_DATE_RANGE", "End date must be on or after start date");
  const days = Math.floor((endMs - startMs) / 86_400_000) + 1;
  assert(days <= MAX_CAMPAIGN_DAYS, 400, "CAMPAIGN_TOO_LONG", `Campaigns can run for at most ${MAX_CAMPAIGN_DAYS} days`);
}
function validateScheduleTime(time: string) {
  const [hour, minute] = time.split(":").map(Number); const total = hour! * 60 + minute!;
  assert(total >= QUIET_START_MINUTES && total <= QUIET_END_MINUTES, 400, "QUIET_HOURS", "Scheduled notifications must be between 08:00 and 22:00");
}
function uniqueSortedTimes(times: string[]) { return [...new Set(times)].sort(); }
function parseStringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function findNextScheduledRun(startDate: string, endDate: string, times: string[], timeZone: string, after: Date): Date | null {
  if (!times.length) return null;
  const afterLocal = localParts(after, timeZone); let cursor = afterLocal.date < startDate ? startDate : afterLocal.date;
  for (let day = 0; day < MAX_CAMPAIGN_DAYS + 2 && cursor <= endDate; day++) {
    for (const time of times) { const candidate = zonedLocalToUtc(cursor, time, timeZone); if (candidate.getTime() > after.getTime() + 500) return candidate; }
    cursor = addLocalDays(cursor, 1);
  }
  return null;
}
function localDateString(date: Date, timeZone: string) { return localParts(date, timeZone).date; }
function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
function zonedLocalToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number), [hour, minute] = time.split(":").map(Number);
  const targetNaive = Date.UTC(year!, month! - 1, day!, hour!, minute!, 0, 0); let guess = targetNaive;
  for (let iteration = 0; iteration < 3; iteration++) { const observed = localPartsDetailed(new Date(guess), timeZone); const observedNaive = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, 0, 0); const delta = targetNaive - observedNaive; if (Math.abs(delta) < 1_000) break; guess += delta; }
  return new Date(guess);
}
function localPartsDetailed(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}
function addLocalDays(date: string, amount: number) { const [year, month, day] = date.split("-").map(Number); const next = new Date(Date.UTC(year!, month! - 1, day! + amount)); return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`; }
function campaignDto(campaign: any, counts: Record<string, number>) {
  return { id: campaign.id, title: campaign.title, body: campaign.body, audienceType: campaign.audienceType, selectedStudentIds: parseStringArray(campaign.selectedStudentIds), financialYear: campaign.financialYear, financialMonth: campaign.financialMonth, scheduleType: campaign.scheduleType, scheduleTimes: parseStringArray(campaign.scheduleTimes), startDate: campaign.startDate, endDate: campaign.endDate, timezone: campaign.timezone, status: campaign.status, nextRunAt: campaign.nextRunAt, lastRunAt: campaign.lastRunAt, createdAt: campaign.createdAt, delivery: { sent: counts.SENT || 0, failed: counts.FAILED || 0, skipped: (counts.SKIPPED_LIMIT || 0) + (counts.SKIPPED_NO_DEVICE || 0), total: Object.values(counts).reduce((sum, value) => sum + value, 0) } };
}
async function resolveOwnerProperty(ownerId: string, req: express.Request) {
  const requestedId = req.header("x-property-id") || (req.query.propertyId ? String(req.query.propertyId) : "");
  const property = requestedId ? await prisma.property.findFirst({ where: { id: requestedId, ownerId } }) : await prisma.property.findFirst({ where: { ownerId }, orderBy: { createdAt: "asc" } });
  assert(property, 404, "PROPERTY_NOT_FOUND", requestedId ? "Property not found or access denied" : "Owner property is not configured");
  return property;
}
function propertyDto(property: { id: string; name: string; currency: string; timezone: string }) { return { id: property.id, name: property.name, currency: property.currency, timezone: property.timezone }; }
function firebaseErrorCode(error: unknown) { const value = error as { code?: string } | undefined; return value?.code || "messaging/unknown-error"; }
function isDeadInstallation(code: string) { return code.includes("installation-id-not-registered") || code.includes("registration-token-not-registered") || code.includes("invalid-registration-token"); }
