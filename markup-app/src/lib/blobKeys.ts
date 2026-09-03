/**
 * Names for the objects a page is stored under.
 *
 * Kept apart from the component that uses it so it can be tested: Node cannot
 * import a .tsx, and this is the part with edge cases worth pinning down.
 */

/** The stem of a Blob object key, from the plan's filename.
 *
 *  A plan called "2830 Lawton St. (rev B).pdf" must not decide what a storage
 *  path looks like -- spaces, dots and slashes all mean something to a key, and
 *  "../.." means something considerably worse. Reduced to letters and digits,
 *  and never to nothing. */
export function safeStem(filename: string): string {
  return (
    filename
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "plan"
  );
}
