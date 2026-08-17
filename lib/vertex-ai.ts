import { GoogleAuth } from "google-auth-library";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;
const MODEL_ID = "gemini-2.5-flash-image"; // "Nano Banana" — text-to-image AND image editing via generateContent

// The "global" location is required for this model — regional endpoints
// (e.g. us-central1) return 404 for it. See README for how this was found.
const ENDPOINT = `https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/global/publishers/google/models/${MODEL_ID}:generateContent`;

let cachedAuth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (cachedAuth) return cachedAuth;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not set — paste the full service account JSON key as one line."
    );
  }

  cachedAuth = new GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  return cachedAuth;
}

interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
}

interface InputImage {
  buffer: Buffer;
  mimeType: string;
}

const VALID_ASPECT_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
export type AspectRatio = (typeof VALID_ASPECT_RATIOS)[number];

/**
 * Sends a text prompt (and optionally an input image) to Gemini 2.5 Flash
 * Image (Vertex AI / Agent Platform) and returns the first generated image.
 *
 * With no `inputImage`, this generates a new image from scratch. With an
 * `inputImage`, the model edits that image according to the prompt (change
 * background, add/remove objects, restyle, etc) — same model, same
 * endpoint, just an extra part in the request.
 *
 * Throws on any API-level or auth error — callers should catch and turn
 * this into a user-facing message (see lib/generate-image.ts).
 */
export async function generateImage(
  prompt: string,
  aspectRatio: AspectRatio = "1:1",
  inputImage?: InputImage
): Promise<GeneratedImage> {
  if (!PROJECT_ID) {
    throw new Error("GOOGLE_CLOUD_PROJECT_ID is not set.");
  }

  const client = await getAuth().getClient();
  const { token } = await client.getAccessToken();

  const parts: Array<Record<string, unknown>> = [];
  if (inputImage) {
    parts.push({
      inline_data: {
        mime_type: inputImage.mimeType,
        data: inputImage.buffer.toString("base64"),
      },
    });
  }
  parts.push({ text: prompt });

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: {
        role: "user",
        parts,
      },
      generation_config: {
        response_modalities: ["TEXT", "IMAGE"],
        image_config: {
          aspect_ratio: VALID_ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : "1:1",
        },
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Vertex AI error ${res.status}: ${errText.slice(0, 500)}`);
  }

  const json = await res.json();
  const responseParts: Array<{ inlineData?: { data: string; mimeType: string } }> =
    json?.candidates?.[0]?.content?.parts ?? [];

  const imagePart = responseParts.find((p) => p.inlineData?.data);
  if (!imagePart?.inlineData) {
    throw new Error("Model did not return an image (it may have refused the prompt).");
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, "base64"),
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}
