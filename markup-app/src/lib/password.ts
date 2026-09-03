import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing and session tokens for team sign-in.
 *
 * Split from teamAuth deliberately: nothing in here touches the database, so
 * a test can import it directly. The parts that do the talking to Prisma live
 * next door, and re-export these so nothing else had to change.
 */

/** scrypt cost. 128 * N * r bytes of memory, so 16 MB here -- inside Node's
 *  32 MB default and slow enough to make a stolen hash unpleasant to attack. */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

/** A shared password lives longer and is typed by more people than a personal
 *  one, so it gets a floor rather than a complexity rule nobody can satisfy. */
export const PASSWORD_MIN_LENGTH = 12;

const SESSION_DAYS = 30;

/** `scrypt$N$r$p$salt$hash`, self-describing so the cost can be raised later
 *  without stranding every password hashed under the old one. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(hashB64, "base64");
    actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
    });
  } catch {
    // A malformed or unreadable hash is a failed sign-in, never a crash that
    // takes the route down.
    return false;
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** 256 bits from the system CSPRNG. Unlike the share tokens, which are cuids,
 *  there is nothing in here to predict. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sessionExpiry(from = new Date()): Date {
  return new Date(from.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}
