"use client";

import Link from "next/link";
import { actions, useCovar } from "@/lib/store";
import { Empty } from "@/components/ui";
import type { NotificationKind } from "@/lib/types";

const KIND_LABEL: Record<NotificationKind, string> = {
  practice: "Practice",
  publish: "Publish",
  money: "Money",
  risk: "Risk",
  copilot: "Copilot",
  system: "System",
};

export default function NotificationsPage() {
  const { notifications } = useCovar();
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="container section-tight stack gap-20" style={{ maxWidth: 760 }}>
      <div className="row between wrap gap-16">
        <div className="stack gap-8">
          <span className="eyebrow">Inbox</span>
          <h1 className="h2">Notifications</h1>
          <p className="tiny" style={{ maxWidth: 560 }}>
            Every entry below is written by something that actually happened in this session — a practice run started or
            stopped, an agent published, money moving off a request. There are no marketing pushes and no fake alerts. An
            empty inbox simply means nothing has happened yet.
          </p>
        </div>
        <div className="row gap-8">
          <button className="btn btn-secondary" onClick={() => actions.markAllNotificationsRead()} disabled={unread === 0}>
            Mark all read{unread > 0 ? ` (${unread})` : ""}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => actions.clearNotifications()}
            disabled={notifications.length === 0}
          >
            Clear
          </button>
        </div>
      </div>

      {notifications.length === 0 ? (
        <Empty
          title="Nothing yet"
          body="Start a practice run, publish an agent, or request a withdrawal — each of those writes an entry here."
          action={
            <Link className="btn btn-primary" href="/studio">
              Open Studio
            </Link>
          }
        />
      ) : (
        <div className="card stack" style={{ padding: 0 }}>
          {notifications.map((n) => (
            <Link
              key={n.id}
              href={n.href ?? "/notifications"}
              onClick={() => actions.markNotificationRead(n.id)}
              className="row gap-12"
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--border)",
                textDecoration: "none",
                alignItems: "flex-start",
              }}
            >
              <span
                aria-hidden
                className="dot"
                style={{
                  marginTop: 6,
                  flex: "0 0 auto",
                  background: n.read ? "var(--border)" : "var(--primary)",
                  opacity: n.read ? 0.4 : 1,
                }}
              />
              <span className="stack gap-6" style={{ flex: 1 }}>
                <span className="row between gap-12 wrap">
                  <span className="small strong" style={{ color: "var(--fg)" }}>
                    {n.title}
                  </span>
                  <span className="tiny mono">{new Date(n.ts).toLocaleString("en-GB")}</span>
                </span>
                <span className="tiny">{n.body}</span>
                <span className="badge badge-outline">{KIND_LABEL[n.kind]}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
