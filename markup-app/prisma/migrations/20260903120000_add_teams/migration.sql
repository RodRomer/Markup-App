-- Teams: a name and one shared password, so Waystone and the staff page can
-- authenticate as a team and see only that team's projects.
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- Sessions are stored rather than signed: signing out has to actually revoke,
-- and a stored session needs no second server secret to keep safe.
CREATE TABLE "Session" (
    "token" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("token")
);
CREATE INDEX "Session_teamId_idx" ON "Session"("teamId");
ALTER TABLE "Session" ADD CONSTRAINT "Session_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nullable on purpose. Projects created before teams existed have no honest
-- team to belong to, and inventing one here would mean inventing its password
-- too. An unassigned project appears on no team's list.
ALTER TABLE "Project" ADD COLUMN "teamId" TEXT;
CREATE INDEX "Project_teamId_idx" ON "Project"("teamId");
ALTER TABLE "Project" ADD CONSTRAINT "Project_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
