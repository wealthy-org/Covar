/**
 * Lighter transaction signer — the official lighter-go signer compiled to WASM.
 *
 * Lighter orders are signed with Lighter's own (non-ECDSA) scheme, so an EVM
 * wallet library cannot produce them. This loads the reference signer from
 * github.com/elliottech/lighter-go (Apache-2.0), built with:
 *
 *   GOOS=js GOARCH=wasm go build -trimpath -o lighter-signer.wasm ./wasm/
 *
 * at commit aefa96848a105d82a6bbb55d3d05663293a71713 (Go 1.26.0), gzipped to
 * keep the repo small. `wasm_exec.cjs` is Go's glue file from the same Go
 * version (BSD). Rebuild both together when updating: see services/venue/lighter/README.md.
 *
 * The WASM side never touches the network: the client is created with an empty
 * URL and every request goes through our own fetch (Lighter's guidance — Go's
 * HTTP stack cannot reach the network from WASM).
 *
 * The API private key is passed in from the process environment by the caller
 * and stays inside this process; nothing here logs or returns it.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";

/* eslint-disable @typescript-eslint/no-explicit-any -- the WASM exports are untyped globals */

export interface SignedTx {
  txType: number;
  txInfo: string;
  txHash?: string;
}

export interface LighterSigner {
  generateApiKey(): { privateKey: string; publicKey: string };
  createClient(opts: { privateKey: string; chainId: number; apiKeyIndex: number; accountIndex: number }): void;
  authToken(opts: { apiKeyIndex: number; accountIndex: number; deadlineUnix?: number }): string;
  createOrder(o: {
    marketIndex: number;
    clientOrderIndex: number;
    baseAmount: number;
    price: number;
    isAsk: boolean;
    orderType: number;
    timeInForce: number;
    reduceOnly: boolean;
    triggerPrice?: number;
    orderExpiry: number;
    nonce: number;
    apiKeyIndex: number;
    accountIndex: number;
  }): SignedTx;
  cancelOrder(o: { marketIndex: number; orderIndex: number; nonce: number; apiKeyIndex: number; accountIndex: number }): SignedTx;
}

export const SIGNER_DIR = process.env.LIGHTER_SIGNER_DIR || path.join(process.cwd(), "services", "venue", "lighter");

let loading: Promise<LighterSigner> | null = null;

function check<T extends Record<string, any>>(res: T): T {
  if (res && typeof res === "object" && res.error) throw new Error(`lighter signer: ${res.error}`);
  return res;
}

function toSigned(res: any): SignedTx {
  check(res);
  const txInfo = typeof res.txInfo === "string" ? res.txInfo : JSON.stringify(res.txInfo);
  return { txType: Number(res.txType), txInfo, txHash: res.txHash };
}

/** Load the WASM signer once per process. */
export function loadSigner(): Promise<LighterSigner> {
  if (loading) return loading;
  loading = (async () => {
    const req = createRequire(path.join(SIGNER_DIR, "noop.js"));
    req(path.join(SIGNER_DIR, "wasm_exec.cjs")); // defines globalThis.Go
    const G = globalThis as any;
    if (typeof G.Go !== "function") throw new Error("wasm_exec.cjs did not define globalThis.Go");
    const gz = fs.readFileSync(path.join(SIGNER_DIR, "lighter-signer.wasm.gz"));
    const bytes = zlib.gunzipSync(gz);
    const go = new G.Go();
    const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
    void go.run(instance); // the Go runtime stays alive; do not await
    // exports are registered synchronously in main(); give the scheduler one tick
    for (let i = 0; i < 50 && typeof G.SignCreateOrder !== "function"; i++) await new Promise((r) => setTimeout(r, 10));
    if (typeof G.SignCreateOrder !== "function") throw new Error("Lighter WASM signer did not register its functions");
    return {
      generateApiKey: () => check(G.GenerateAPIKey()),
      createClient: ({ privateKey, chainId, apiKeyIndex, accountIndex }) => {
        check(G.CreateClient("", privateKey, chainId, apiKeyIndex, accountIndex));
      },
      authToken: ({ apiKeyIndex, accountIndex, deadlineUnix = 0 }) =>
        check(G.CreateAuthToken(deadlineUnix, apiKeyIndex, accountIndex)).authToken as string,
      createOrder: (o) =>
        toSigned(
          G.SignCreateOrder(
            o.marketIndex,
            o.clientOrderIndex,
            o.baseAmount,
            o.price,
            o.isAsk ? 1 : 0,
            o.orderType,
            o.timeInForce,
            o.reduceOnly ? 1 : 0,
            o.triggerPrice ?? 0,
            o.orderExpiry,
            0, // integratorAccountIndex
            0, // integratorTakerFee
            0, // integratorMakerFee
            0, // selfTradeBehaviorMode: expire maker
            0, // selfTradeEqualityMode: same account
            0, // skipNonce
            o.nonce,
            o.apiKeyIndex,
            o.accountIndex,
          ),
        ),
      cancelOrder: (o) => toSigned(G.SignCancelOrder(o.marketIndex, o.orderIndex, 0, o.nonce, o.apiKeyIndex, o.accountIndex)),
    } satisfies LighterSigner;
  })();
  loading.catch(() => (loading = null));
  return loading;
}
