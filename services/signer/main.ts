import path from "node:path";
import { createSigner } from "./app";
import { serve } from "../shared/http";
import type { OrderIntent } from "../shared/types";

const PORT = Number(process.env.SIGNER_PORT || 4013);
const DIR = process.env.COVAR_STATE_DIR || path.join(process.cwd(), ".covar-state");

const signer = createSigner({ dir: DIR });

serve("signer", PORT, [
  {
    method: "POST",
    path: "/sign",
    handler: ({ body }) => ({
      body: signer.sign({
        clientOrderId: String(body.clientOrderId),
        intent: body.intent as OrderIntent,
        destination: body.destination ? String(body.destination) : undefined,
      }),
    }),
  },
  { method: "GET", path: "/stats", handler: () => ({ body: signer.stats() }) },
  { method: "GET", path: "/journal", handler: () => ({ body: signer.journalEntries() }) },
  { method: "GET", path: "/health", handler: () => ({ body: { service: "signer", ok: true, ...signer.stats() } }) },
]);
