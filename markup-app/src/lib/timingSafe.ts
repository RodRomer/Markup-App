/**
 * Comparing a secret someone sent against the one expected.
 *
 * Constant-time, so a wrong secret cannot be recovered by timing the answer,
 * and over a fixed length, so the loop count never depends on the input. No
 * imports, so the rule can be tested by calling it.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
