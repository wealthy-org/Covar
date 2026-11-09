/**
 * Alert sink (package 3.10): Telegram bot when configured, console otherwise.
 *
 *   TELEGRAM_BOT_TOKEN   from @BotFather (server-side only, never in git/chat)
 *   TELEGRAM_CHAT_ID     your user/group id (message the bot, then read getUpdates)
 *   ALERT_COOLDOWN_SEC   same source+code is not re-sent inside this window (default 1800)
 *
 * Every alert — sent, suppressed or failed — is journaled, so a Telegram outage
 * never loses the record. Resolutions ("RESOLVED …") always pass the cooldown.
 */
import { Journal } from "../shared/journal";

export interface AlertMessage {
  source: string;
  level: "info" | "warn" | "critical";
  code: string;
  message: string;
  resolved?: boolean;
}

export interface AlertSink {
  describe: string;
  send(a: AlertMessage): Promise<"sent" | "suppressed" | "logged" | "failed">;
}

const ICON = { info: "ℹ️", warn: "⚠️", critical: "🚨" } as const;

export function formatAlert(a: AlertMessage, env = "testnet") {
  const head = a.resolved ? `✅ RESOLVED · ${a.code}` : `${ICON[a.level]} ${a.level.toUpperCase()} · ${a.code}`;
  return `${head}\n[${a.source} · ${env}]\n${a.message}`;
}

export function createAlertSink(opts: {
  dir: string;
  token?: string;
  chatId?: string;
  cooldownSec?: number;
  apiBase?: string;
  label?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): AlertSink {
  const journal = new Journal(opts.dir, "alerts");
  const cooldown = (opts.cooldownSec ?? 1800) * 1000;
  const now = opts.now ?? Date.now;
  const lastSent = new Map<string, number>();
  const doFetch = opts.fetchImpl ?? fetch;
  const telegram = !!(opts.token && opts.chatId);
  const base = (opts.apiBase ?? "https://api.telegram.org").replace(/\/$/, "");

  return {
    describe: telegram ? `telegram chat ${opts.chatId}` : "console only (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)",
    async send(a) {
      const key = `${a.source}:${a.code}`;
      const t = now();
      if (!a.resolved && (lastSent.get(key) ?? -Infinity) > t - cooldown) {
        journal.append("alerts", "suppressed", { ...a });
        return "suppressed";
      }
      if (a.resolved) lastSent.delete(key);
      else lastSent.set(key, t);

      if (!telegram) {
        journal.append("alerts", "logged", { ...a });
        return "logged";
      }
      try {
        const res = await doFetch(`${base}/bot${opts.token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: opts.chatId, text: formatAlert(a, opts.label), disable_web_page_preview: true }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
        if (!res.ok || body.ok === false) throw new Error(`telegram ${res.status}: ${body.description ?? "rejected"}`);
        journal.append("alerts", "sent", { ...a });
        return "sent";
      } catch (e) {
        lastSent.delete(key); // retry next time instead of silently cooling down
        journal.append("alerts", "send_failed", { ...a, error: (e as Error).message.replace(opts.token ?? "\u0000", "<token>") });
        console.error(`[alerts] Telegram send failed: ${(e as Error).message.replace(opts.token ?? "\u0000", "<token>")}`);
        return "failed";
      }
    },
  };
}

export function alertSinkFromEnv(env: Record<string, string | undefined>, dir: string, fetchImpl?: typeof fetch): AlertSink {
  return createAlertSink({
    dir,
    token: env.TELEGRAM_BOT_TOKEN || undefined,
    chatId: env.TELEGRAM_CHAT_ID || undefined,
    cooldownSec: env.ALERT_COOLDOWN_SEC ? Number(env.ALERT_COOLDOWN_SEC) : undefined,
    apiBase: env.TELEGRAM_API_BASE || undefined,
    label: env.ALERT_LABEL || env.OPERATOR_CHAIN || "testnet",
    fetchImpl,
  });
}
