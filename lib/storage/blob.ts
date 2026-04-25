import { put, del } from "@vercel/blob";

export async function putBuffer(
  pathname: string,
  data: Buffer,
  contentType?: string
): Promise<{ url: string; pathname: string }> {
  const blob = await put(pathname, data, {
    access: "public",
    contentType,
    addRandomSuffix: true,
  });
  return { url: blob.url, pathname: blob.pathname };
}

export async function deleteBlob(url: string): Promise<void> {
  await del(url);
}
