/**
 * MONITOR_TARGETS parsing: `name=url,name=url`. Also forgiving of what people
 * actually type into .env on Windows: a known service name alone
 * (`operator,indexer`), a bare URL, `name: url`, quotes, `;` or spaces as
 * separators. An entry that still makes no sense is reported, never a crash.
 */
export const KNOWN_SERVICES: Record<string, number> = {
  execution: 4010,
  exchange: 4011,
  risk: 4012,
  signer: 4013,
  operator: 4014,
  monitor: 4015,
  indexer: 4016,
};

export const DEFAULT_TARGETS = "execution,risk,signer,exchange,operator";

export function parseTargets(raw: string | undefined): { targets: { name: string; url: string }[]; problems: string[] } {
  const src = (raw ?? "").trim().replace(/^["']|["']$/g, "") || DEFAULT_TARGETS;
  const targets: { name: string; url: string }[] = [];
  const problems: string[] = [];
  for (const entry of src.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean)) {
    const m = entry.match(/^([a-z][\w-]*)\s*[=:](?!\/\/)\s*(.+)$/i); // name=url or name:url (not "http://")
    let name: string | undefined;
    let url: string | undefined;
    if (m) {
      name = m[1];
      url = m[2];
    } else if (/^https?:\/\//i.test(entry)) {
      url = entry;
      try {
        const u = new URL(entry);
        name = Object.entries(KNOWN_SERVICES).find(([, p]) => String(p) === u.port)?.[0] ?? u.host;
      } catch {
        name = undefined;
      }
    } else if (KNOWN_SERVICES[entry.toLowerCase()]) {
      name = entry.toLowerCase();
      url = `http://127.0.0.1:${KNOWN_SERVICES[name]}`;
    }
    if (!name || !url || !/^https?:\/\/[^\s]+$/i.test(url)) {
      problems.push(`ignored MONITOR_TARGETS entry "${entry}" (use name=http://host:port, e.g. operator=http://127.0.0.1:4014)`);
      continue;
    }
    targets.push({ name, url: url.replace(/\/$/, "") });
  }
  return { targets, problems };
}
