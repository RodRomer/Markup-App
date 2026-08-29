-- Width of a revision callout box, as a fraction of page width.
-- Nullable and additive: existing markers keep NULL and fall back to the
-- automatic width derived from their text.
ALTER TABLE "Marker" ADD COLUMN "boxWidth" DOUBLE PRECISION;
