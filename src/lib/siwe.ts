/**
 * Sign-In with Ethereum (EIP-4361) message format: build + strict parse.
 *
 * Pure and dependency-free, so it runs in route handlers and in tests. The
 * server builds the exact text the wallet signs (domain and URI come from the
 * request, the nonce from the DB), and later parses the signed text back,
 * refusing anything that is not byte-for-byte the expected shape.
 */
export interface SiweFields {
  domain: string;
  address: string;
  statement?: string;
  uri: string;
  version: "1";
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
}

export const SIWE_STATEMENT = "Sign in to Covar. This signature proves you own this wallet. It costs no gas and authorises no transaction.";

export function buildSiweMessage(f: SiweFields): string {
  const lines = [`${f.domain} wants you to sign in with your Ethereum account:`, f.address, ""];
  if (f.statement) lines.push(f.statement, "");
  lines.push(`URI: ${f.uri}`, `Version: ${f.version}`, `Chain ID: ${f.chainId}`, `Nonce: ${f.nonce}`, `Issued At: ${f.issuedAt}`);
  if (f.expirationTime) lines.push(`Expiration Time: ${f.expirationTime}`);
  return lines.join("\n");
}

const HEADER = / wants you to sign in with your Ethereum account:$/;

export function parseSiweMessage(text: string): SiweFields {
  if (typeof text !== "string" || text.length > 2000) throw new Error("message too long or not text");
  const lines = text.split("\n");
  const head = lines[0] ?? "";
  if (!HEADER.test(head)) throw new Error("not a SIWE message");
  const domain = head.replace(HEADER, "");
  const address = lines[1] ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("bad address line");
  if (lines[2] !== "") throw new Error("malformed message");
  let i = 3;
  let statement: string | undefined;
  if (lines[i] !== undefined && !lines[i].startsWith("URI: ")) {
    statement = lines[i];
    if (lines[i + 1] !== "") throw new Error("malformed statement");
    i += 2;
  }
  const field = (name: string, required = true) => {
    const l = lines[i];
    if (l === undefined || !l.startsWith(`${name}: `)) {
      if (required) throw new Error(`missing ${name}`);
      return undefined;
    }
    i++;
    return l.slice(name.length + 2);
  };
  const uri = field("URI")!;
  const version = field("Version")!;
  if (version !== "1") throw new Error("unsupported SIWE version");
  const chainId = Number(field("Chain ID"));
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("bad chain id");
  const nonce = field("Nonce")!;
  if (!/^[A-Za-z0-9]{8,64}$/.test(nonce)) throw new Error("bad nonce");
  const issuedAt = field("Issued At")!;
  if (Number.isNaN(Date.parse(issuedAt))) throw new Error("bad issued-at");
  const expirationTime = field("Expiration Time", false);
  if (expirationTime !== undefined && Number.isNaN(Date.parse(expirationTime))) throw new Error("bad expiration");
  if (i !== lines.length) throw new Error("unexpected trailing fields");
  return { domain, address, statement, uri, version: "1", chainId, nonce, issuedAt, expirationTime };
}
