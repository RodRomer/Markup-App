import assert from "node:assert/strict";
import test from "node:test";

import { resetScopeFrom } from "../src/lib/resetScope.ts";

// The two things the buttons in MarkupEditor actually send.
test("the reset buttons say which one they are", () => {
  assert.deepEqual(resetScopeFrom('{"scope":"project"}'), { kind: "project" });
  assert.deepEqual(resetScopeFrom('{"scope":"page","pageId":"page_2"}'),
                   { kind: "page", pageId: "page_2" });
});

// A tab left open on the bundle from before `scope` existed still works. Drop
// this test and the two lines it guards once no such tab can be open.
test("a tab open since before scope existed still works", () => {
  assert.deepEqual(resetScopeFrom("{}"), { kind: "project" });
  assert.deepEqual(resetScopeFrom('{"pageId":"page_2"}'), { kind: "page", pageId: "page_2" });
});

// The fault this file exists for: every one of these used to reach the branch
// that deletes every marker in the project, and answer 200 {"ok":true}.
test("a page reset that lost its page is refused, never widened", () => {
  for (const body of [
    '{"pageId":"pag',          // truncated in flight
    "",                        // body dropped
    "pageId=page_2",           // sent as form data
    '{"page_id":"page_2"}',    // field renamed by a later client
    '{"pageId":""}',
    '{"pageId":null}',
    '{"pageId":3}',
    '{"scope":"page"}',        // scope kept, pageId lost
    "[]",
    '"just a string"',
  ]) {
    const scope = resetScopeFrom(body);
    assert.equal(scope.kind, "invalid", `${body || "(empty)"} was read as ${scope.kind}`);
    assert.match((scope as { reason: string }).reason, /scope/,
                 "the refusal has to say what a good request looks like");
  }
});

test("a scope this route does not know is refused rather than guessed at", () => {
  assert.equal(resetScopeFrom('{"scope":"everything"}').kind, "invalid");
  assert.equal(resetScopeFrom('{"scope":"page","pageId":"p"}').kind, "page");
});
