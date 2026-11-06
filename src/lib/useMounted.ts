"use client";

import { useEffect, useState } from "react";

/**
 * True after the first client render. Seed timestamps are derived from
 * Date.now() at module load, so server and browser disagree by a few seconds;
 * time strings rendered before mount would trip a hydration mismatch.
 */
export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}
