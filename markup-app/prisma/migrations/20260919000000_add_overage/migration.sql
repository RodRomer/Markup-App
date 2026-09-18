-- Warden's first job: the overage check.
--
-- Three new tables and nothing else. No existing table is altered, so this
-- cannot change how any project, markup, login or tool grant behaves. The SQL is
-- what `prisma migrate diff` generates from the schema, plus comments and the
-- CHECK on OverageAlert.kind.

-- One run of the check: when, whether it worked, and every CAD Live project's
-- status as rows. A failed run is recorded as failed -- Warden has to be able to
-- tell "found nothing" from "could not look".
CREATE TABLE "OverageRun" (
    "id" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" TEXT NOT NULL,
    "byMemberId" TEXT,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "report" JSONB,

    CONSTRAINT "OverageRun_pkey" PRIMARY KEY ("id")
);

-- One problem with one project, ever. `sentAt` is never cleared by a run, which
-- is what makes "once only" hold: a sent alert is not offered again.
CREATE TABLE "OverageAlert" (
    "id" TEXT NOT NULL,
    "oppId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "projectNumber" TEXT NOT NULL,
    "drafter" TEXT NOT NULL,
    "pmEmail" TEXT NOT NULL,
    "overage" INTEGER,
    "sfEst" INTEGER,
    "notesSf" INTEGER,
    "threshold" INTEGER,
    "businessDays" INTEGER,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "sentByMemberId" TEXT,
    "sentTo" TEXT,

    CONSTRAINT "OverageAlert_pkey" PRIMARY KEY ("id"),
    -- The two alerts the rules raise. Anything else is a bug writing here, and
    -- would sit in Warden as an email nobody can compose.
    CONSTRAINT "OverageAlert_kind" CHECK ("kind" IN ('MISSING_SF', 'OVER_SF'))
);

-- Drafter name -> email, kept by admins in Warden, because Keap's Drafter Name
-- field holds names only. `key` is the normalised name the match is made on.
CREATE TABLE "DrafterEmail" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByMemberId" TEXT,

    CONSTRAINT "DrafterEmail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OverageRun_ranAt_idx" ON "OverageRun"("ranAt");
CREATE INDEX "OverageAlert_sentAt_resolvedAt_idx" ON "OverageAlert"("sentAt", "resolvedAt");
-- One row per project per kind: a second would be a second chance to email.
CREATE UNIQUE INDEX "OverageAlert_oppId_kind_key" ON "OverageAlert"("oppId", "kind");
CREATE UNIQUE INDEX "DrafterEmail_key_key" ON "DrafterEmail"("key");
