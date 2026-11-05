import fs from "node:fs";
import path from "node:path";
import type { JournalEntry } from "./types";

/**
 * Append-only journal with fsync on every write.
 *
 * This is the durability layer for order intents. A process that dies mid-flight
 * must be able to answer "what did I already tell the venue?" — an in-memory queue
 * cannot, and re-submitting blindly is how agents double-trade.
 *
 * One file per service keeps ownership clear: execution owns intents/orders,
 * risk owns decisions, the venue and signer own their audit trails.
 */
export class Journal {
  private seq = 0;
  readonly file: string;

  constructor(dir: string, service: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${service}.jsonl`);
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, "");
  }

  append(service: string, type: string, payload: Record<string, unknown>): JournalEntry {
    const entry: JournalEntry = {
      seq: ++this.seq,
      at: new Date().toISOString(),
      service,
      type,
      payload,
    };
    const fd = fs.openSync(this.file, "a");
    try {
      fs.writeSync(fd, `${JSON.stringify(entry)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return entry;
  }

  read(): JournalEntry[] {
    if (!fs.existsSync(this.file)) return [];
    return fs
      .readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as JournalEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is JournalEntry => e !== null);
  }

  /** Seeds the sequence counter so appends after a restart stay ordered. */
  resume(): JournalEntry[] {
    const entries = this.read();
    this.seq = entries.reduce((max, e) => Math.max(max, e.seq), 0);
    return entries;
  }

  size(): number {
    return this.read().length;
  }
}
