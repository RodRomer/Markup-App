import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";

const STORAGE_DIR = path.join(process.cwd(), "public", "uploads");

// Vercel's serverless filesystem isn't persistent, so production uses Vercel
// Blob instead (auto-configured via BLOB_READ_WRITE_TOKEN once a Blob store
// is attached to the project). Local dev with no token falls back to the
// filesystem. Callers only ever deal in (key, publicUrl) pairs either way —
// deleteFile is handed back whatever saveFile returned, stripped of the
// "/uploads/" prefix when present (a no-op for blob URLs, which don't have it).
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

export async function saveFile(key: string, data: Buffer): Promise<string> {
  if (useBlob) {
    const { put } = await import("@vercel/blob");
    const { url } = await put(key, data, { access: "public", addRandomSuffix: false });
    return url;
  }
  await mkdir(STORAGE_DIR, { recursive: true });
  await writeFile(path.join(STORAGE_DIR, key), data);
  return `/uploads/${key}`;
}

export async function deleteFile(key: string): Promise<void> {
  if (useBlob) {
    const { del } = await import("@vercel/blob");
    await del(key).catch(() => {});
    return;
  }
  await unlink(path.join(STORAGE_DIR, key)).catch(() => {});
}
