-- The PPM project number, for linking a markup to its Keap opportunity.
--
-- Separate from the name because the name is what a person calls the job and
-- the number is what Keap knows it by. Deriving one from the other means
-- guessing, and a wrong guess puts "Delivered" and a delete button beside a
-- live project.
--
-- Nullable: every project created before this field existed has no number and
-- falls back to whatever can be read off its name.
ALTER TABLE "Project" ADD COLUMN "projectNumber" TEXT;
CREATE INDEX "Project_projectNumber_idx" ON "Project"("projectNumber");
