// Deleting a page, and deleting a project, each remove an image from storage
// and a record from the database. The image went first. If the database step
// then failed, the record survived pointing at a file that no longer existed --
// and a page whose plan will not load is the same empty rectangle as a page
// that is genuinely blank, with the marker tools still live over it.
//
// The routes' own text is run: only the import lines are replaced with stubs,
// and the rest is checked to be the file on disk.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "..");
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);

const PAGE_ROUTE = path.join(REPO, "src/app/api/projects/[id]/pages/[pageId]/route.ts");
const PROJECT_ROUTE = path.join(REPO, "src/app/api/projects/[id]/route.ts");

const PAGES = [
  "{ id: 'page_1', pageNumber: 1, imagePath: 'https://blob/doc-0.png' }",
  "{ id: 'page_2', pageNumber: 2, imagePath: 'https://blob/doc-1.png' }",
];

const STUB = [
  "export const events = [];",
  "export let failDb = false;",
  "export function setFailDb(v) { failDb = v; }",
  "export function reset() { events.length = 0; failDb = false; }",
  "const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };",
  "const requireTeam = async () => ({ teamId: 'team_1', teamName: 'Test' });",
  "const isDenied = () => false;",
  "const deleteFile = async (key) => { events.push('image: ' + key); };",
  "const toProjectData = (p) => p;",
  "const generateProjectPdf = async () => new Uint8Array();",
  "const prisma = {",
  `  project: { findUnique: async () => ({ id: 'proj_1', name: 'p', documents: [{ pages: [${PAGES.join(", ")}] }] }),`,
  `             findFirst: async () => ({ id: 'proj_1', name: 'p', documents: [{ pages: [${PAGES.join(", ")}] }] }),`,
  "             delete: async () => { if (failDb) throw new Error('database refused'); events.push('project row'); },",
  "             update: async () => ({}) },",
  "  page: { delete: (a) => ({ kind: 'page row', a }), update: (a) => ({ kind: 'renumber', a }) },",
  "  $transaction: async (ops) => {",
  "    if (failDb) throw new Error('database refused');",
  "    for (const op of ops) events.push(op.kind);",
  "    return ops;",
  "  },",
  "};",
];

async function routeUnderTest(file: string): Promise<RouteModule> {
  const source = readFileSync(file, "utf8").split(CR + NL).join(NL).split(NL);
  const importCount = source.findIndex((line) => !line.startsWith("import "));
  assert.ok(importCount >= 2, `no import block in ${path.basename(file)}`);
  const body = source.slice(importCount);
  assert.ok(body.join(NL).includes("deleteFile("), "this route deletes no file");

  const temp = path.join(mkdtempSync(path.join(tmpdir(), "delorder-")), "route.ts");
  writeFileSync(temp, [...STUB, ...body].join(NL), "utf8");
  return (await import(pathToFileURL(temp).href)) as RouteModule;
}

type RouteModule = {
  DELETE: (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<unknown>;
  events: string[];
  reset: () => void;
  setFailDb: (v: boolean) => void;
};

async function run(mod: RouteModule, params: Record<string, string>, failDb: boolean) {
  mod.reset();
  mod.setFailDb(failDb);
  let threw: string | null = null;
  try {
    await mod.DELETE(new Request("https://x/api"), { params: Promise.resolve(params) });
  } catch (e) {
    threw = (e as Error).message;
  }
  return { events: [...mod.events], threw };
}

const CASES: { what: string; file: string; params: Record<string, string>; record: string }[] = [
  { what: "a page", file: PAGE_ROUTE, params: { id: "proj_1", pageId: "page_1" }, record: "page row" },
  { what: "a project", file: PROJECT_ROUTE, params: { id: "proj_1" }, record: "project row" },
];

for (const { what, file, params, record } of CASES) {
  test(`deleting ${what} removes the record before the image`, async () => {
    const mod = await routeUnderTest(file);
    const { events, threw } = await run(mod, params, false);

    // The control: with nothing failing, both go.
    assert.equal(threw, null, `it threw on the happy path: ${threw}`);
    assert.ok(events.some((e) => e === record), `no ${record} was deleted: ${events}`);
    const image = events.findIndex((e) => e.startsWith("image:"));
    assert.notEqual(image, -1, `no image was deleted: ${events}`);
    assert.ok(image > events.indexOf(record),
              `the image goes before the record: ${JSON.stringify(events)}`);
  });

  test(`a failed database step for ${what} destroys nothing`, async () => {
    const mod = await routeUnderTest(file);
    const { events, threw } = await run(mod, params, true);

    assert.ok(threw, "the database was supposed to refuse");
    assert.deepEqual(events, [],
      `the image was destroyed while the record survived: ${JSON.stringify(events)}`);
  });
}


// --- the half that makes it visible ---------------------------------------
//
// Even with the ordering right, an image can fail to load for reasons this app
// does not control -- a blob store outage, a link opened offline. The <img> had
// only onLoad, so a plan that 404s was an empty rectangle with the marker tools
// still live over it.
import { pageImageProblem } from "../src/lib/markerTypes.ts";

const PAGE = { id: "page_1", pageNumber: 3 };

test("a page that loaded says nothing", () => {
  // The control. If this ever speaks up, every client sees a warning about a
  // plan that is fine.
  assert.equal(pageImageProblem(PAGE, []), null);
  assert.equal(pageImageProblem(PAGE, ["page_9"]), null);
});

test("a page that would not load says so, and says not to mark it up", () => {
  const message = pageImageProblem(PAGE, ["page_1"]);

  assert.ok(message, "a plan that failed to load looked exactly like a blank one");
  assert.match(message, /Page 3/, "it should name the page");
  assert.match(message, /not the plan/i);
  assert.match(message, /don't mark it up/i);
});

test("no page at all is not a failed page", () => {
  assert.equal(pageImageProblem(null, ["page_1"]), null);
  assert.equal(pageImageProblem(undefined, ["page_1"]), null);
});

test("the editor renders that message and clears it when a page loads", () => {
  // Structural, and deliberately so: the message is checked above, but nothing
  // here can mount a DOM to fire an <img> error. These are the two call sites
  // that turn it into something a client sees.
  const editor = readFileSync(
    path.join(REPO, "src/components/MarkupEditor.tsx"), "utf8");
  assert.match(editor, /onError=/, "the image reports no failure at all");
  assert.match(editor, /pageImageProblem\(activePage, unloadablePages\)/);
  assert.match(editor, /ids\.filter\(\(id\) => id !== activePage\.id\)/,
               "a page that loads on a retry must stop being reported");
});
