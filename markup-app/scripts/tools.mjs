#!/usr/bin/env node
/**
 * Decide which Waystone tools a team or a person gets.
 *
 *   npm run tools -- show PPM              # what a team's logins would see
 *   npm run tools -- grant PPM cache       # give a team a tool
 *   npm run tools -- revoke PPM snip       # take one away from a team
 *   npm run tools -- grant rodney lookup --person    # give one person a tool
 *   npm run tools -- revoke rodney markup --person   # refuse one person a tool
 *   npm run tools -- clear rodney lookup --person    # drop the rule entirely
 *
 * The tools are Waystone's own keys: cache (Vault), lookup (Oracle),
 * snip (Mirror), markup (Rune), admin (Warden). Home and Settings are always
 * available and cannot be granted or taken away.
 *
 * **admin is restricted: nobody has it until it is granted**, whatever their
 * team's configuration, and granting it never configures a team. Give it to
 * people, not teams:
 *
 *   npm run tools -- grant rodney admin --person
 *
 * **A team with no rules at all gets everything.** The first grant is therefore
 * the moment a team stops seeing every tool and starts seeing only what it has
 * been given -- so grant the full set in one go unless you mean to narrow it.
 *
 * `revoke` and `clear` are different. Revoking a person records a refusal that
 * beats their team's grant; clearing removes the rule and puts them back on
 * whatever their team has.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.MARKUP_APP_URL ?? "https://runemarks.vercel.app";

function adminKey() {
  const fromEnv = process.env.MARKUP_STAFF_KEY;
  if (fromEnv) return fromEnv;
  const text = readFileSync(path.join(ROOT, ".env"), "utf8");
  const line = text.split(/\r?\n/).find((l) => l.trim().startsWith("MARKUP_STAFF_KEY="));
  if (!line) throw new Error("MARKUP_STAFF_KEY is not in .env.");
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

async function call(method, body) {
  const res = await fetch(`${BASE}/api/tools`, {
    method,
    headers: { "content-type": "application/json", "x-waystone-key": adminKey() },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) throw new Error(parsed?.error ?? `HTTP ${res.status}`);
  return parsed;
}

const args = process.argv.slice(2);
const person = args.includes("--person");
const [command, who, tool] = args.filter((a) => a !== "--person");
const owner = person ? { member: who } : { team: who };

try {
  if (command === "show") {
    // Read as that team would: the admin key cannot sign in, so this reports the
    // rules rather than the resolved list.
    const members = await (await fetch(`${BASE}/api/members`, {
      headers: { "x-waystone-key": adminKey() },
    })).json();
    console.log(`Logins on ${who}:`);
    for (const m of members.filter((m) => m.team === who)) {
      console.log(`  ${m.name}${m.disabledAt ? " (disabled)" : ""}`);
    }
    console.log("\nSign in as one of them in Waystone to see the rail they get.");
  } else if (command === "grant" || command === "revoke") {
    if (!who || !tool) throw new Error(`Usage: npm run tools -- ${command} <name> <tool> [--person]`);
    await call("POST", { ...owner, tool, allowed: command === "grant" });
    console.log(command === "grant"
      ? `${who} now has ${tool}.`
      : `${who} is refused ${tool}${person ? ", whatever their team has" : ""}.`);
  } else if (command === "clear") {
    if (!who || !tool) throw new Error("Usage: npm run tools -- clear <name> <tool> [--person]");
    await call("DELETE", { ...owner, tool });
    console.log(person
      ? `${who} is back on whatever their team has for ${tool}.`
      : `${who} has no rule for ${tool} any more.`);
  } else {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("*/")[0].replace("#!/usr/bin/env node\n/**", "").trim());
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
