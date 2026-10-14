import nodemailer from "nodemailer";
import prisma from "../db.server";

// Operator alerts: email the app's owner when something breaks — weather
// API failing or running out of free calls, the queue stalling, prints or
// billing failing, unexpected server errors. Each alert kind is sent at
// most once per throttle window (default 1h); repeats in between are
// counted and reported in the next email.
//
// Configure with env vars (Vercel → Settings → Environment Variables):
//   ALERT_EMAIL_TO    comma-separated recipients
//   ALERT_EMAIL_FROM  sender, e.g. "Weather Slip <alerts@yourdomain>"
//   SMTP_HOST, SMTP_PORT (465 = TLS, 587 = STARTTLS), SMTP_USER, SMTP_PASS
// Without them, alerts are only logged.

const HOUR = 60 * 60 * 1000;
export const OPENWEATHER_FREE_MONTHLY = 1_000_000;
const USAGE_THRESHOLDS = [50, 80, 95, 100];

function transport(to = process.env.ALERT_EMAIL_TO) {
  const host = process.env.SMTP_HOST;
  if (!host || !to) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

/** Send one email now (no throttling). Returns false if mail isn't configured or fails. */
export async function sendAlertEmail(subject: string, text: string): Promise<boolean> {
  const t = transport();
  if (!t) {
    console.error(`[alert] (email not configured) ${subject}\n${text}`);
    return false;
  }
  try {
    await t.sendMail({
      from: process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER,
      to: process.env.ALERT_EMAIL_TO,
      subject: `[Weather Slip] ${subject}`,
      text: `${text}\n\n— ${process.env.SHOPIFY_APP_URL || "Weather Slip"} · ${new Date().toISOString()}`,
    });
    return true;
  } catch (err) {
    console.error("[alert] email failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Email a merchant (not the operator). Returns false if mail isn't configured or fails. */
export async function sendMerchantEmail(to: string, subject: string, text: string): Promise<boolean> {
  const t = transport(to);
  if (!t) {
    console.error(`[merchant-email] (email not configured) to ${to}: ${subject}`);
    return false;
  }
  try {
    await t.sendMail({ from: process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER, to, subject, text });
    return true;
  } catch (err) {
    console.error("[merchant-email] failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Alert the operator, at most once per `key` per throttle window. Never
 * throws — monitoring must not break the thing it monitors.
 */
export async function notifyAdmin(
  key: string,
  subject: string,
  details: string,
  { throttleMs = HOUR }: { throttleMs?: number } = {},
): Promise<void> {
  try {
    const now = new Date();
    const prev = await prisma.adminAlert.findUnique({ where: { key } });
    if (prev && now.getTime() - prev.lastSentAt.getTime() < throttleMs) {
      await prisma.adminAlert.update({
        where: { key },
        data: { suppressed: { increment: 1 }, lastMessage: details.slice(0, 2000) },
      });
      console.error(`[alert] ${key} (throttled): ${subject}`);
      return;
    }
    const repeats = prev?.suppressed
      ? `\n\nThis also happened ${prev.suppressed} more time(s) since the last email.`
      : "";
    await prisma.adminAlert.upsert({
      where: { key },
      create: { key, lastSentAt: now, lastMessage: details.slice(0, 2000) },
      update: { lastSentAt: now, suppressed: 0, lastMessage: details.slice(0, 2000) },
    });
    await sendAlertEmail(subject, details + repeats);
  } catch (err) {
    console.error("[alert] notify failed:", key, err instanceof Error ? err.message : err);
  }
}

/** Fire-and-forget variant for hot paths. */
export function notifyAdminLater(key: string, subject: string, details: string): void {
  void notifyAdmin(key, subject, details);
}

/**
 * Count one outbound call to a provider this month and email at 50/80/95/100%
 * of its free allowance (once per threshold per month).
 */
export async function recordApiCall(provider: string, monthlyLimit: number, now = new Date()) {
  try {
    const id = `${provider}:${now.toISOString().slice(0, 7)}`;
    const row = await prisma.apiUsage.upsert({
      where: { id },
      create: { id, count: 1 },
      update: { count: { increment: 1 } },
    });
    const pct = Math.floor((row.count / monthlyLimit) * 100);
    const crossed = USAGE_THRESHOLDS.filter((t) => pct >= t && t > row.alertedPct).pop();
    if (crossed) {
      // Claim the threshold atomically so concurrent calls email once.
      const { count } = await prisma.apiUsage.updateMany({
        where: { id, alertedPct: { lt: crossed } },
        data: { alertedPct: crossed },
      });
      if (count === 1) {
        await sendAlertEmail(
          `${provider} usage at ${crossed}% of the free monthly allowance`,
          `${row.count.toLocaleString("en-US")} of ${monthlyLimit.toLocaleString("en-US")} ${provider} calls used in ${id.split(":")[1]}.\n\n` +
            (crossed >= 100
              ? "The free allowance is used up: weather lookups will start failing until the month resets. Add a paid key or upgrade the OpenWeather plan."
              : "Reprints use saved weather and nearby orders share a 3-hour cache, so usage should stay low — check for unusual traffic."),
        );
      }
    }
  } catch (err) {
    console.error("[alert] usage count failed:", err instanceof Error ? err.message : err);
  }
}
