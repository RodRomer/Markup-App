// The route itself, run with a stubbed database, so what is under test is the
// file that ships rather than a description of it. Only the import lines are
// rewritten -- the database stubbed out, "@/..." pointed at the real source --
// and the rest is asserted identical to the file on disk.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "..");
const ROUTE = path.join(REPO, "src/app/api/markup/[token]/reset/route.ts");
const SRC_URL = pathToFileURL(path.join(REPO, "src")).href;

const STUB = [
  "export const captured: { where: unknown }[] = [];",
  "export function resetCaptured() { captured.length = 0; }",
  "const NextResponse = { json: (body: unknown, init?: { status?: number }) =>",
  "  ({ body, status: init?.status ?? 200 }) };",
  "const prisma = {",
  '  project: { findUnique: async () => ({ id: "proj_1" }) },',
  "  marker: { deleteMany: async (args: { where: unknown }) => {",
  "    captured.push({ where: args.where }); return { count: 7 }; } },",
  "};",
  "export const touched: string[] = [];",
  "const touchProject = async (token: string) => { touched.push(token); };",
];

function buildRouteUnderTest() {
  const original = readFileSync(ROUTE, "utf8").split(/\r?\n/);
  const importCount = original.findIndex((line) => !line.startsWith("import "));
  assert.ok(importCount >= 2, "no import block found -- is this still the route?");

  const kept = original.slice(0, importCount)
    .filter((line) => line !== 'import { NextResponse } from "next/server";'
                   && line !== 'import { prisma } from "@/lib/db";'
                   && line !== 'import { touchProject } from "@/lib/activity";')
    .map((line) => line.replace('"@/', `"${SRC_URL}/`).replace(/";$/, '.ts";'));

  const body = original.slice(importCount);
  assert.ok(body.join("\n").includes("deleteMany"),
            "the body under test deletes nothing -- wrong file?");

  const file = path.join(mkdtempSync(path.join(tmpdir(), "reset-route-")), "route.ts");
  writeFileSync(file, [...kept, ...STUB, ...body].join("\n"), "utf8");
  return import(pathToFileURL(file).href);
}

type Attempt = { status: number; body: unknown; where: Record<string, unknown> | undefined };

async function post(rawBody: string | undefined, contentType = "application/json"): Promise<Attempt> {
  const mod = await buildRouteUnderTest();
  mod.resetCaptured();
  const request = new Request("https://example.invalid/api/markup/tok/reset", {
    method: "POST",
    headers: { "Content-Type": contentType },
    ...(rawBody === undefined ? {} : { body: rawBody }),
  });
  const res = await mod.POST(request, { params: Promise.resolve({ token: "tok" }) });
  return { status: res.status, body: res.body, where: mod.captured[0]?.where };
}

const scopeOf = (a: Attempt) =>
  a.status !== 200 ? "refused" :
  a.where === undefined ? "nothing" :
  "pageId" in a.where ? "one page" : "whole project";

test("the two buttons still do what they say", async () => {
  assert.equal(scopeOf(await post('{"scope":"project"}')), "whole project");
  assert.equal(scopeOf(await post('{"scope":"page","pageId":"page_2"}')), "one page");
  // ...and so does a tab open since before `scope` existed.
  assert.equal(scopeOf(await post("{}")), "whole project");
  assert.equal(scopeOf(await post('{"pageId":"page_2"}')), "one page");
});

test("a page reset whose body did not arrive is refused, not widened", async () => {
  // Every one of these used to answer 200 {"ok":true} having deleted every
  // marker in the project, right after the client confirmed "Delete all
  // markers on this page?" -- and the editor clears only the open page in its
  // own state, so the rest stayed on screen while being gone from the database.
  for (const [label, body, type] of [
    ["truncated in flight", '{"pageId":"pag'],
    ["body dropped", undefined],
    ["field renamed", '{"page_id":"page_2"}'],
    ["pageId empty", '{"pageId":""}'],
    ["scope kept, pageId lost", '{"scope":"page"}'],
    ["form data, not JSON", "pageId=page_2", "application/x-www-form-urlencoded"],
  ] as [string, string | undefined, string?][]) {
    const attempt = await post(body, type);
    assert.equal(scopeOf(attempt), "refused", `${label} was carried out as a ${scopeOf(attempt)}`);
    assert.equal(attempt.status, 400, label);
  }
});

test("the caller is told which of the two happened", async () => {
  assert.deepEqual((await post('{"scope":"page","pageId":"p"}')).body,
                   { ok: true, scope: "page", deleted: 7 });
  assert.deepEqual((await post('{"scope":"project"}')).body,
                   { ok: true, scope: "project", deleted: 7 });
});
