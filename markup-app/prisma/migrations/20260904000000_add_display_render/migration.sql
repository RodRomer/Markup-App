-- A second, smaller render of each page for the editor to show.
--
-- The stored image is 200 DPI so the PDF export can be plotted at size. The
-- browser then shrinks it to fit, which averages a black hairline away to pale
-- grey and decodes 138 MB per page. This column holds the same page rendered
-- natively at display size, where the lines keep their weight.
--
-- Nullable: every page that already exists has only the full-resolution image,
-- and the editor falls back to it.
ALTER TABLE "Page" ADD COLUMN "displayPath" TEXT;
ALTER TABLE "Page" ADD COLUMN "displayWidth" INTEGER;
ALTER TABLE "Page" ADD COLUMN "displayHeight" INTEGER;
