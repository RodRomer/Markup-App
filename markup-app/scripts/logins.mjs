#!/usr/bin/env node
/**
 * Create and manage the logins people sign in with.
 *
 *   npm run logins -- list
 *   npm run logins -- add rodney PPM
 *   npm run logins -- password rodney
 *   npm run logins -- disable rodney
 *   npm run logins -- enable rodney
 *
 * The password is typed at a hidden prompt, never given as an argument: an
 * argument ends up in shell history, in the process list while it runs, and in
 * any terminal recording. The admin key is read from .env and never printed.
 *
 * A login is a person; the team it belongs to is what decides which projects
 * they see. Two people on one team share the work and nothing else.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.MARKUP_APP_URL ?? "https://runemarks.vercel.app";

function adminKey() {
  const fromEnv = process.env.MARKUP_STAFF_KEY;
  if (fromEnv) return fromEnv;
  let text;
  try {
    text = readFileSync(path.join(ROOT, ".env"), "utf8");
  } catch {
    throw new Error("No MARKUP_STAFF_KEY set and no .env to read it from.");
  }
  const line = text.split(/\r?\n/).find((l) => l.trim().startsWith("MARKUP_STAFF_KEY="));
  if (!line) throw new Error("MARKUP_STAFF_KEY is not in .env.");
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

/** Ask for a password without echoing it, and without leaving it anywhere. */
function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(prompt);
    // Everything typed is swallowed rather than drawn: readline's own muting
    // still echoes the first character on Windows.
    const onData = () => process.stdout.write("");
    rl.output.write = () => {};
    process.stdin.on("data", onData);
    rl.question("", (answer) => {
      process.stdin.off("data", onData);
      rl.output.write = process.stdout.write.bind(process.stdout);
      rl.close();
      process.stdout.write("\n");
      answer ? resolve(answer) : reject(new Error("Nothing typed."));
    });
  });
}

async function call(method, body) {
  const res = await fetch(`${BASE}/api/members`, {
    method,
    headers: { "content-type": "application/json", "x-waystone-key": adminKey() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${BASE} answered ${res.status} with something that is not JSON.`);
  }
  if (!res.ok) throw new Error(parsed?.error ?? `HTTP ${res.status}`);
  return parsed;
}

const [command, name, team] = process.argv.slice(2);

try {
  if (command === "list") {
    const members = await call("GET");
    if (!members.length) {
      console.log("No personal logins yet -- everyone is still using the shared team password.");
    }
    for (const m of members) {
      const state = m.disabledAt ? `disabled ${m.disabledAt.slice(0, 10)}` : "active";
      console.log(`${m.name.padEnd(16)} ${m.team.padEnd(10)} ${state.padEnd(22)} ${m.openSessions} open session(s)`);
    }
  } else if (command === "add") {
    if (!name || !team) throw new Error("Usage: npm run logins -- add <name> <team>");
    const password = await askHidden(`Password for ${name} (at least 12 characters): `);
    await call("POST", { name, team, password });
    console.log(`${name} can now sign in to Waystone and the staff page, and sees ${team}'s projects.`);
  } else if (command === "password") {
    if (!name) throw new Error("Usage: npm run logins -- password <name>");
    const password = await askHidden(`New password for ${name}: `);
    await call("PATCH", { name, password });
    console.log(`Changed. ${name} is signed out everywhere and will need the new one.`);
  } else if (command === "disable" || command === "enable") {
    if (!name) throw new Error(`Usage: npm run logins -- ${command} <name>`);
    await call("PATCH", { name, disabled: command === "disable" });
    console.log(command === "disable"
      ? `${name} is signed out everywhere and cannot sign in again.`
      : `${name} can sign in again.`);
  } else {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace("#!/usr/bin/env node\n/**", "").trim());
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
