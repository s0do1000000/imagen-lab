"use client";

/**
 * Downscales and re-encodes an image file in the browser before upload.
 * Phone photos can be 10+ MB — sending that as base64 JSON would blow past
 * Vercel's serverless request body limit. Capping the longest side and
 * re-encoding as JPEG keeps every upload comfortably small.
 */
export async function resizeImageForUpload(
  file: File,
  maxDimension = 1600,
  quality = 0.85
): Promise<{ base64: string; mimeType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Failed to decode image"));
    el.src = dataUrl;
  });

  let { width, height } = img;
  if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported in this browser");
  ctx.drawImage(img, 0, 0, width, height);

  const outDataUrl = canvas.toDataURL("image/jpeg", quality);
  const base64 = outDataUrl.split(",")[1] ?? "";
  return { base64, mimeType: "image/jpeg" };
}
