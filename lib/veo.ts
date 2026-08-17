import { GoogleAuth } from "google-auth-library";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;
// Confirmed via Vertex AI Media Studio's "View Code" for this exact
// project: the GA model ID (no "-preview" suffix) on the us-central1
// regional endpoint. The "-preview" variant 404s — it's not in this
// project's list of supported models, even though it's a valid Veo model
// name in general.
const MODEL_ID = "veo-3.1-fast-generate-001";
const REGION = "us-central1";
const BASE = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL_ID}`;

let cachedAuth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (cachedAuth) return cachedAuth;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  cachedAuth = new GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  return cachedAuth;
}

async function getToken(): Promise<string> {
  const client = await getAuth().getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Failed to obtain access token.");
  return token;
}

export type VideoAspectRatio = "16:9" | "9:16";

interface VideoResult {
  buffer: Buffer;
  mimeType: string;
}

/** Starts a Veo video generation job and returns its operation name. */
async function startVideoGeneration(prompt: string, aspectRatio: VideoAspectRatio): Promise<string> {
  if (!PROJECT_ID) throw new Error("GOOGLE_CLOUD_PROJECT_ID is not set.");
  const token = await getToken();

  const res = await fetch(`${BASE}:predictLongRunning`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { aspectRatio, sampleCount: 1 },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Veo start error ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  if (!json.name) throw new Error("Veo did not return an operation name.");
  return json.name as string;
}

/** Polls a Veo operation once. Videos are returned as base64 bytes directly
 * in the response since we don't configure a Cloud Storage output bucket. */
async function pollOnce(
  operationName: string
): Promise<{ done: boolean; buffer?: Buffer; mimeType?: string; error?: string }> {
  const token = await getToken();
  const res = await fetch(`${BASE}:fetchPredictOperation`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ operationName }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Veo poll error ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = await res.json();
  if (!json.done) return { done: false };

  if (json.error) {
    return { done: true, error: json.error.message || "unknown error" };
  }

  const video = json.response?.videos?.[0];
  if (!video?.bytesBase64Encoded) {
    return { done: true, error: "Видео не вернулось в ответе (возможно, запрос отфильтрован)." };
  }

  return {
    done: true,
    buffer: Buffer.from(video.bytesBase64Encoded, "base64"),
    mimeType: video.mimeType || "video/mp4",
  };
}

/**
 * Generates a short video from a text prompt. Veo runs as a long-running
 * operation, unlike the image models — this starts the job and polls every
 * `pollIntervalMs` until done or `maxWaitMs` elapses. Typical generations
 * take 30s–2min, so callers should not block a Telegram webhook response on
 * this directly — see lib/bot.ts's use of `after()` for the background
 * pattern that avoids Telegram retrying the webhook mid-generation.
 */
export async function generateVideo(
  prompt: string,
  aspectRatio: VideoAspectRatio = "16:9",
  maxWaitMs = 280_000,
  pollIntervalMs = 10_000
): Promise<VideoResult> {
  const operationName = await startVideoGeneration(prompt, aspectRatio);

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const result = await pollOnce(operationName);
    if (result.done) {
      if (result.error) throw new Error(result.error);
      if (!result.buffer || !result.mimeType) throw new Error("Видео сгенерировалось без результата.");
      return { buffer: result.buffer, mimeType: result.mimeType };
    }
  }

  throw new Error("Превышено время ожидания видео — попробуйте более простой запрос.");
}
