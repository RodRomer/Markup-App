-- One sign-in per person, without splitting up the work.
--
-- Team was doing two jobs: it held the credential *and* it scoped the projects.
-- So a second login meant a second team, which meant a second, separate set of
-- projects -- no use to people who need to see the same ones. A Member is the
-- credential; the team stays the scope. Everyone still sees their team's
-- projects, and each person can be refused on their own.
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    -- Set rather than deleted, so the record of who did what survives the person
    -- leaving. Their sessions are removed at the same time.
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);
-- Unique across the app, not per team: sign-in is by name and password alone,
-- exactly as the team sign-in was, so two people cannot share a name.
CREATE UNIQUE INDEX "Member_name_key" ON "Member"("name");
CREATE INDEX "Member_teamId_idx" ON "Member"("teamId");
ALTER TABLE "Member" ADD CONSTRAINT "Member_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nullable: sessions opened with the shared team password have no member, and
-- that password keeps working until everyone has their own login.
ALTER TABLE "Session" ADD COLUMN "memberId" TEXT;
CREATE INDEX "Session_memberId_idx" ON "Session"("memberId");
ALTER TABLE "Session" ADD CONSTRAINT "Session_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
