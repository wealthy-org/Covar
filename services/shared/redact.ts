/**
 * Never expose provider API keys. Alchemy / Infura / QuickNode / dRPC put the key
 * in the URL path or query; health endpoints and errors must not echo it.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/(\/v[23]\/)[A-Za-z0-9_-]{8,}/g, "$1***")
    .replace(/([?&](?:apikey|api_key|key|token|dkey)=)[^&\s"]+/gi, "$1***")
    .replace(/(https?:\/\/[^/\s"]+\/)[A-Za-z0-9_-]{24,}/g, "$1***");
}
