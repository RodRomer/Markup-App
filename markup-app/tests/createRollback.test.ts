// A project's row, document and share token are created before its first page
// exists. Every way out of the upload loop therefore used to leave a real,
// listable, shareable project holding only the pages that got through -- and a
// three-page remnant of a six-page set is indistinguishable from a genuine
// three-page project. It lists as Sent, its Copy Link works, and a client sent
// that link marks up an incomplete set with nothing saying so.
//
// Both create paths are covered: the JSON one (images already in Blob) and the
// multipart one (bytes proxied through the route). The route's own text is run;
// only its import lines are replaced, and the rest is asserted to be the file
// on disk.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "..");
const ROUTE = path.join(REPO, "src/app/api/projects/route.ts");
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);

const STUB = [
  "export const events = [];",
  "export const state = { failSaveAt: -1, failPageAt: -1, stored: 0, miscount: false };",
  "let saveCalls = 0, pageCalls = 0;",
  "export function reset(o) {",
  "  events.length = 0; saveCalls = 0; pageCalls = 0;",
  "  Object.assign(state, { failSaveAt: -1, failPageAt: -1, stored: 0, miscount: false }, o || {});",
  "}",
  "const NextResponse = { json: (body, init) => ({ body, status: (init && init.status) || 200 }) };",
  "const requireTeam = async () => ({ teamId: 'team_1', teamName: 'Test' });",
  "const isDenied = () => false;",
  "const saveFile = async (key) => {",
  "  if (saveCalls++ === state.failSaveAt) throw new Error('blob store unavailable');",
  "  events.push('blob saved: ' + key);",
  "  return '/uploads/' + key;",
  "};",
  "const deleteFile = async (key) => { events.push('blob deleted: ' + key); };",
  "const prisma = {",
  "  project: {",
  "    create: async () => ({ id: 'proj_1', shareToken: 'tok_1' }),",
  "    delete: async () => { events.push('project row deleted'); return {}; },",
  "  },",
  "  document: { create: async () => ({ id: 'doc_1' }) },",
  "  page: {",
  "    create: async () => {",
  "      if (pageCalls++ === state.failPageAt) throw new Error('database refused');",
  "      state.stored++;",
  "      events.push('page created');",
  "      return {};",
  "    },",
  "    count: async () => (state.miscount ? state.stored - 1 : state.stored),",
  "  },",
  "};",
];

type RouteModule = {
  POST: (request: Request) => Promise<{ body: { error?: string; id?: string }; status: number }>;
  events: string[];
  reset: (o?: Record<string, unknown>) => void;
};

let cached: RouteModule | null = null;

async function routeUnderTest(): Promise<RouteModule> {
  if (cached) return cached;
  const source = readFileSync(ROUTE, "utf8").split(CR + NL).join(NL).split(NL);
  const importCount = source.findIndex((line) => !line.startsWith("import "));
  assert.ok(importCount >= 3, "no import block at the top of the create route");
  const body = source.slice(importCount).join(NL);

  // If these vanish the test is no longer testing the fix.
  assert.ok(body.includes("rollbackProject("), "the route no longer rolls back");
  assert.ok(body.includes("assertEveryPageStored("), "the route no longer verifies the page count");

  const temp = path.join(mkdtempSync(path.join(tmpdir(), "createroll-")), "route.ts");
  writeFileSync(temp, [...STUB, body].join(NL), "utf8");
  cached = (await import(pathToFileURL(temp).href)) as unknown as RouteModule;
  return cached;
}

const META = (n: number) => JSON.stringify(Array.from({ length: n }, () => ({ width: 7200, height: 4800 })));

function multipart(pages: number, omitFileAt = -1): Request {
  const fd = new FormData();
  fd.set("name", "2830 Lawton Street");
  fd.set("kind", "pdf");
  fd.set("originalFilename", "plans.pdf");
  fd.set("meta", META(pages));
  for (let i = 0; i < pages; i++) {
    if (i === omitFileAt) continue;
    fd.set(`file-${i}`, new File([new Uint8Array([1, 2, 3])], `page-${i}.png`, { type: "image/png" }));
  }
  return new Request("https://x/api/projects", { method: "POST", body: fd });
}

function json(pages: number): Request {
  return new Request("https://x/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "2830 Lawton Street",
      kind: "pdf",
      originalFilename: "plans.pdf",
      pages: Array.from({ length: pages }, (_, i) => ({
        imagePath: `https://blob/doc-${i}.png`, width: 7200, height: 4800,
      })),
    }),
  });
}

async function run(request: Request, failure: Record<string, unknown> = {}) {
  const mod = await routeUnderTest();
  mod.reset(failure);
  const res = await mod.POST(request);
  return { res, events: [...mod.events] };
}

const rolledBack = (events: string[]) => events.includes("project row deleted");

// --- the control, first: none of the below means anything if this is wrong ---

test("a create that works keeps the project and deletes nothing", async () => {
  for (const [label, request] of [["multipart", multipart(5)], ["json", json(5)]] as const) {
    const { res, events } = await run(request);
    assert.equal(res.status, 200, `${label}: happy path did not return 200`);
    assert.ok(res.body.id, `${label}: no project id returned`);
    assert.equal(events.filter((e) => e === "page created").length, 5, `${label}: not all pages stored`);
    assert.equal(rolledBack(events), false, `${label}: rolled back a create that worked`);
    assert.equal(events.some((e) => e.startsWith("blob deleted")), false,
                 `${label}: deleted an image on the happy path`);
  }
});

// --- every way the loop can fail after the project exists ---

test("a missing file part-way leaves no project behind", async () => {
  const { res, events } = await run(multipart(5, 3));

  assert.equal(res.status, 400, "a missing file should still be a 400");
  assert.match(res.body.error ?? "", /page 3/);
  assert.ok(rolledBack(events), "the project survived a create that failed at page 3");
  assert.equal(events.filter((e) => e.startsWith("blob saved")).length, 3, "expected 3 images written");
  assert.equal(events.filter((e) => e.startsWith("blob deleted")).length, 3,
               "the images written before the failure were left orphaned");
});

test("a database refusal part-way leaves no project behind", async () => {
  const { res, events } = await run(multipart(6), { failPageAt: 3 });

  assert.equal(res.status, 500);
  assert.ok(rolledBack(events), "the project survived a database failure at page 4");
  assert.equal(events.filter((e) => e.startsWith("blob deleted")).length, 4,
               "every image written should be cleaned up");
});

test("a blob store failure cleans up only what actually reached storage", async () => {
  const { res, events } = await run(multipart(6), { failSaveAt: 3 });

  assert.equal(res.status, 500);
  assert.ok(rolledBack(events), "the project survived a storage failure");
  // Three succeeded; the fourth threw and was never written, so it must not be
  // chased -- deleting a key that does not exist is a second error to no purpose.
  assert.equal(events.filter((e) => e.startsWith("blob deleted")).length, 3,
               "cleanup chased an image that was never stored");
});

test("the JSON path rolls back too, taking the caller's uploads with it", async () => {
  const { res, events } = await run(json(5), { failPageAt: 2 });

  assert.equal(res.status, 500);
  assert.ok(rolledBack(events), "the JSON create path left a half-made project");
  assert.equal(events.filter((e) => e.startsWith("blob deleted")).length, 5,
               "the images uploaded for this project should go with it");
});

test("a short page count is caught even when nothing threw", async () => {
  // The belt to the braces: every write reported success and one page is still
  // missing. A project must never be returned holding fewer pages than asked for.
  const { res, events } = await run(multipart(5), { miscount: true });

  assert.equal(res.status, 500);
  assert.match(res.body.error ?? "", /4 of 5/);
  assert.ok(rolledBack(events), "a short project was returned as if it were complete");
});

// --- the ordering rule the delete routes already follow ---

test("the record goes before the images, never after", async () => {
  const { events } = await run(multipart(6), { failPageAt: 4 });

  const row = events.indexOf("project row deleted");
  const firstBlob = events.findIndex((e) => e.startsWith("blob deleted"));
  assert.notEqual(row, -1, "no project row was deleted");
  assert.notEqual(firstBlob, -1, "no image was deleted");
  assert.ok(row < firstBlob,
            `images were deleted before the record: ${JSON.stringify(events.filter((e) => !e.startsWith("blob saved")))}`);
});
