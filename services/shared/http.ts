import http from "node:http";

export type Ctx = {
  body: Record<string, unknown>;
  params: Record<string, string>;
  query: URLSearchParams;
};
export type Handler = (ctx: Ctx) => Promise<{ status?: number; body: unknown }> | { status?: number; body: unknown };

interface Route {
  method: "GET" | "POST";
  path: string;
  handler: Handler;
}

function match(routePath: string, actual: string): Record<string, string> | null {
  const a = routePath.split("/").filter(Boolean);
  const b = actual.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

/**
 * Minimal JSON HTTP server. Each Covar service owns a port and a journal; the
 * boundaries between them are the point, so they are separate processes rather
 * than imports.
 */
export function serve(name: string, port: number, routes: Route[]) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          res.writeHead(400).end(JSON.stringify({ error: "invalid JSON body" }));
          return;
        }
      }
    }

    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = match(route.path, url.pathname);
      if (!params) continue;
      try {
        const out = await route.handler({ body, params, query: url.searchParams });
        res.writeHead(out.status ?? 200).end(JSON.stringify(out.body));
      } catch (e) {
        console.error(`[${name}] ${req.method} ${url.pathname} →`, (e as Error).message);
        res.writeHead(500).end(JSON.stringify({ error: (e as Error).message }));
      }
      return;
    }

    res.writeHead(404).end(JSON.stringify({ error: `no route for ${req.method} ${url.pathname}` }));
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[${name}] listening on :${port}`);
  });
  return server;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function getJson<T>(url: string): Promise<T | undefined> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}
