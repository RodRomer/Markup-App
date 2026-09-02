// What a POST to /api/markup/<token>/reset is asking to delete.
//
// The route used to decide with `pageId ? {page-scoped} : {whole project}`,
// over a body read as `await request.json().catch(() => ({}))`. So a page
// reset whose body did not arrive intact -- truncated, dropped, sent as form
// data, or carrying a field name a later client renamed -- fell through to the
// branch that deletes every marker in the project, answered 200 {"ok":true},
// and looked exactly like the button that meant to do that. The client had
// just confirmed "Delete all markers on this page?", and the editor only
// clears the active page in its own state, so the other pages' markers stayed
// on screen while being gone from the database. Nothing said otherwise until
// a reload, or until the staff PDF came out empty.
//
// So: a request that does not clearly say what it wants is refused, and
// deleting everything happens only when that is what was asked for.

export type ResetScope =
  | { kind: "page"; pageId: string }
  | { kind: "project" }
  | { kind: "invalid"; reason: string };

const SAY_WHAT = "Say what to reset: {\"scope\":\"project\"} or {\"scope\":\"page\",\"pageId\":\"...\"}.";

function pageScope(value: unknown): ResetScope {
  return typeof value === "string" && value.trim() !== ""
    ? { kind: "page", pageId: value }
    : { kind: "invalid", reason: "A page reset needs a pageId. " + SAY_WHAT };
}

export function resetScopeFrom(rawBody: string): ResetScope {
  if (rawBody.trim() === "") {
    return { kind: "invalid", reason: "No request body. " + SAY_WHAT };
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { kind: "invalid", reason: "The request body isn't JSON. " + SAY_WHAT };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "invalid", reason: SAY_WHAT };
  }

  const { scope, pageId } = body as { scope?: unknown; pageId?: unknown };

  if (scope === "page") return pageScope(pageId);
  if (scope === "project") return { kind: "project" };
  if (scope !== undefined) {
    return { kind: "invalid", reason: `Unknown scope ${JSON.stringify(scope)}. ` + SAY_WHAT };
  }

  // No scope: a tab still running the bundle from before this field existed,
  // which said "the whole project" by sending {} and named a page by sending
  // {pageId}. Both are still honoured -- but {pageId: ""} or {pageId: 3} is
  // a page reset that lost its page, not a request to clear everything.
  // Removable once no such tab can still be open.
  if (pageId !== undefined) return pageScope(pageId);
  // That old bundle sent exactly {} or {pageId}. Anything else reaching here is
  // a client meaning something this route does not understand -- a renamed
  // field, most likely -- and guessing "everything" is the wrong guess.
  const keys = Object.keys(body as object);
  if (keys.length > 0) {
    return { kind: "invalid", reason: `Unexpected ${JSON.stringify(keys)}. ` + SAY_WHAT };
  }
  return { kind: "project" };
}
