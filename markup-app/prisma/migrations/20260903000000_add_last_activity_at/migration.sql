-- Track when a client last did something, separately from when the project
-- was created. Both are shown to staff, and the difference between them is
-- what tells someone whether a project has moved since they last looked.
ALTER TABLE "Project" ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing projects have no activity history, and defaulting them to "now"
-- would show every one of them as freshly updated on the first deploy.
-- Their creation date is the only honest answer.
UPDATE "Project" SET "lastActivityAt" = "createdAt";
