/** Output cap per Copilot call. Reasoning models (gpt-oss, Gemini Flash) spend part of it thinking; the JSON itself is ~100 tokens. Credits reserve against this worst case. */
export const COPILOT_MAX_OUTPUT_TOKENS = 1000;
