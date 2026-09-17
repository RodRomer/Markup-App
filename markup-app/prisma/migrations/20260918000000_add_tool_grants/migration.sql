-- Which tools a login may use in Waystone.
--
-- A grant belongs to a team or to one person, never both: the team grant is the
-- normal case, and a member row is the exception that adds a tool to one person
-- or takes one away without touching their team.
--
-- `allowed = false` on a member row is a refusal, and beats the team's grant.
-- Without it the only way to keep one person out of a tool would be to remove it
-- from everyone and grant it back one by one.
CREATE TABLE "ToolGrant" (
    "id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "teamId" TEXT,
    "memberId" TEXT,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ToolGrant_pkey" PRIMARY KEY ("id"),
    -- Exactly one owner. A row with both would have to pick one to obey, and a
    -- row with neither grants a tool to nobody while looking like it grants it.
    CONSTRAINT "ToolGrant_one_owner" CHECK (("teamId" IS NULL) <> ("memberId" IS NULL))
);

-- One rule per tool per owner: a second row for the same pair could say allowed
-- and denied at once.
CREATE UNIQUE INDEX "ToolGrant_teamId_tool_key" ON "ToolGrant"("teamId", "tool");
CREATE UNIQUE INDEX "ToolGrant_memberId_tool_key" ON "ToolGrant"("memberId", "tool");

ALTER TABLE "ToolGrant" ADD CONSTRAINT "ToolGrant_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ToolGrant" ADD CONSTRAINT "ToolGrant_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
