-- Optional per-IE price. Nullable on purpose: no price at all is a
-- different thing from a price of zero, and existing projects have none.
ALTER TABLE "Project" ADD COLUMN "pricePerIE" DOUBLE PRECISION;
