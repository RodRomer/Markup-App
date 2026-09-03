import { prisma } from "@/lib/db";

/**
 * Record that a client has just done something to a project.
 *
 * Every event worth calling "activity" -- a marker placed, moved, retyped or
 * deleted, a page reset, a submit, a reopen -- happens in the Marker table or
 * changes only a status, so Prisma's `@updatedAt` on Project would sit still
 * through all of it. Hence an explicit field, written here.
 *
 * Keyed by share token because that is what the client-facing routes already
 * have in hand, and `shareToken` is unique.
 *
 * Deliberately swallows its own failure. This is bookkeeping: a client who has
 * just placed a marker must not be told their work failed because a timestamp
 * could not be written. The cost is that a missed touch is silent, which shows
 * up as a project looking staler than it is -- the safe direction, since it
 * invites a second look rather than discouraging one.
 */
export async function touchProject(shareToken: string): Promise<void> {
  try {
    await prisma.project.update({
      where: { shareToken },
      data: { lastActivityAt: new Date() },
    });
  } catch {
    // Nothing to do and nothing worth failing the caller's request over.
  }
}
