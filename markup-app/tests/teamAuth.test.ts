// Team sign-in replaced one shared key that opened everything. The parts worth
// testing are the ones where a quiet failure is indistinguishable from success:
// a hash that always verifies, a salt that is not really per-team, a malformed
// stored hash that throws instead of refusing.
import assert from "node:assert/strict";
import test from "node:test";

import {
  PASSWORD_MIN_LENGTH,
  hashPassword,
  newSessionToken,
  sessionExpiry,
  verifyPassword,
} from "../src/lib/password.ts";

const PASSWORD = "correct horse battery staple";

test("the right password verifies and a wrong one does not", () => {
  const stored = hashPassword(PASSWORD);

  assert.equal(verifyPassword(PASSWORD, stored), true, "the real password was refused");
  // The control matters more than the line above: a verifier that always says
  // yes passes that one and fails every one of these.
  assert.equal(verifyPassword(PASSWORD + " ", stored), false, "a trailing space was accepted");
  assert.equal(verifyPassword(PASSWORD.toUpperCase(), stored), false, "case was ignored");
  assert.equal(verifyPassword("", stored), false, "an empty password was accepted");
  assert.equal(verifyPassword("wrong", stored), false, "any password was accepted");
});

test("the stored hash contains neither the password nor a reusable secret", () => {
  const stored = hashPassword(PASSWORD);
  assert.equal(stored.includes(PASSWORD), false, "the password is in its own hash");
  assert.match(stored, /^scrypt\$16384\$8\$1\$/, "the cost is no longer recorded in the hash");
});

test("two teams choosing the same password do not share a hash", () => {
  const a = hashPassword(PASSWORD);
  const b = hashPassword(PASSWORD);

  assert.notEqual(a, b, "the salt is not per-team, so one cracked hash would open both");
  // Both must still verify -- a salt that broke verification would be caught by
  // the first test only if it happened to be the one hashed there.
  assert.equal(verifyPassword(PASSWORD, a), true);
  assert.equal(verifyPassword(PASSWORD, b), true);
});

test("a stored hash that makes no sense is a refusal, not a crash", () => {
  // These reach verifyPassword from the database, and the login route calls it
  // with a dummy hash for a team that does not exist. Throwing here would turn
  // a wrong sign-in into a 500 and take the route down.
  for (const junk of [
    "",
    "notahash",
    "scrypt$16384$8$1$onlyfiveparts",
    "bcrypt$16384$8$1$c2FsdA==$aGFzaA==",
    "scrypt$abc$def$ghi$c2FsdA==$aGFzaA==",
    "scrypt$16384$8$1$!!!not-base64!!!$!!!nor-this!!!",
  ]) {
    assert.equal(verifyPassword(PASSWORD, junk), false, `accepted or threw on ${junk || "(empty)"}`);
  }
});

test("session tokens are long and never repeat", () => {
  const tokens = new Set(Array.from({ length: 200 }, () => newSessionToken()));

  assert.equal(tokens.size, 200, "two session tokens collided in two hundred draws");
  for (const token of tokens) {
    // 32 random bytes as base64url. Unlike the share tokens, which are cuids
    // carrying a timestamp and a counter, there is nothing here to predict.
    assert.equal(token.length, 43, `unexpected token length: ${token}`);
    assert.match(token, /^[A-Za-z0-9_-]+$/, "not URL-safe");
  }
});

test("a session expires, and not today", () => {
  const now = new Date("2026-09-03T12:00:00Z");
  const days = (sessionExpiry(now).getTime() - now.getTime()) / 86_400_000;

  assert.equal(days, 30, `sessions last ${days} days`);
});

test("the shared-password floor is a real number", () => {
  assert.ok(PASSWORD_MIN_LENGTH >= 12,
            `a password shared by a whole team should not be ${PASSWORD_MIN_LENGTH} characters`);
});
