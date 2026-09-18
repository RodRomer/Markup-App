/**
 * Whether a request is Vercel's scheduler, rather than anyone else.
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` to a cron route when the
 * project has a CRON_SECRET set. Anyone on the internet can call the same URL,
 * and the overage run spends Keap's rate limit and writes to the database, so
 * the secret has to be checked.
 *
 * Fails closed. With no CRON_SECRET configured nobody is let in -- including
 * Vercel -- which is a missed morning run, visible in Warden as an old "last
 * ran". The alternative is an open endpoint that looks exactly like a
 * working one.
 */
import { timingSafeEqual } from "./timingSafe.ts";

export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  if (!authorization) return false;
  return timingSafeEqual(authorization, `Bearer ${secret}`);
}
