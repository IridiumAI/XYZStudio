import type { CostPlan, CreateSessionInput, Scene, Transcript } from "@xyzstudio/shared";

export interface SessionRow {
  id: string;
  title: string;
  ideaPrompt: string;
  style: string;
  language: "en" | "zh-Hans";
  aspect: "16x9" | "9x16";
  voiceId: string;
  budgetUsd: number;
  status: string;
  createdAt: string;
}

export interface TranscriptVersionRow {
  id: string;
  version: number;
  source: "generated" | "user_edit" | "llm_revision";
  feedbackMessage: string | null;
  content: Transcript;
  createdAt: string;
}

export interface SessionDetail extends SessionRow {
  latestVersion: TranscriptVersionRow | null;
  costPlan: { perSceneRouting: CostPlan["perScene"]; estimatedTotalUsd: number } | null;
  actualSpendUsd: number;
}

export interface SceneAsset {
  id: string;
  sessionId: string;
  sceneIndex: number;
  kind: string;
  language: string | null;
  path: string;
  providerMeta: unknown;
  createdAt: string;
}

export interface SceneSelection {
  selectedNarrationAssetId: string | null;
  selectedVideoAssetId: string | null;
}

export interface SceneAssetsResponse {
  narrationAssets: SceneAsset[];
  videoAssets: SceneAsset[];
  selection: SceneSelection;
}

export interface SceneSelectionRow extends SceneSelection {
  id: string;
  sessionId: string;
  sceneIndex: number;
  updatedAt: string;
}

export type SceneEditPatch = Partial<
  Pick<Scene, "timestampStart" | "timestampEnd" | "narration" | "visualDescription" | "sceneClass">
>;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listVoices: (language: string) =>
    request<{ id: string; label: string }[]>(`/api/voices?language=${language}`),
  listSessions: () => request<SessionRow[]>("/api/sessions"),
  getSession: (id: string) => request<SessionDetail>(`/api/sessions/${id}`),
  createSession: (input: CreateSessionInput) =>
    request<SessionRow>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listVersions: (id: string) =>
    request<TranscriptVersionRow[]>(`/api/sessions/${id}/versions`),
  saveTranscriptEdit: (id: string, transcript: Transcript) =>
    request<TranscriptVersionRow>(`/api/sessions/${id}/transcript`, {
      method: "PUT",
      body: JSON.stringify(transcript),
    }),
  getSceneAssets: (sessionId: string, sceneIndex: number) =>
    request<SceneAssetsResponse>(
      `/api/sessions/${sessionId}/scenes/${sceneIndex}/assets`,
    ),
  listSceneSelections: (sessionId: string) =>
    request<SceneSelectionRow[]>(`/api/sessions/${sessionId}/scene-selections`),
  editScene: (sessionId: string, sceneIndex: number, patch: SceneEditPatch) =>
    request<TranscriptVersionRow>(
      `/api/sessions/${sessionId}/scenes/${sceneIndex}`,
      { method: "PUT", body: JSON.stringify(patch) },
    ),
  setSceneSelection: (
    sessionId: string,
    sceneIndex: number,
    sel: { narrationAssetId?: string | null; videoAssetId?: string | null },
  ) =>
    request<SceneSelectionRow>(
      `/api/sessions/${sessionId}/scenes/${sceneIndex}/selection`,
      { method: "PUT", body: JSON.stringify(sel) },
    ),
};

export type SseEvent =
  | { type: "delta"; text: string }
  | { type: "complete"; version: number; transcript: Transcript; costPlan: CostPlan }
  | { type: "error"; message: string };

export type AssetSseEvent =
  | { type: "complete"; asset: SceneAsset }
  | { type: "error"; message: string };

/** Generic SSE reader — caller provides typed event handler. */
async function readSseBody<T>(
  res: Response,
  onEvent: (event: T) => void,
): Promise<void> {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (chunk.startsWith("data: ")) {
        onEvent(JSON.parse(chunk.slice(6)) as T);
      }
    }
  }
}

/** POST + read an SSE body for asset generation (narration / video). */
export async function streamAssetSse(
  url: string,
  onEvent: (event: AssetSseEvent) => void,
): Promise<void> {
  const res = await fetch(url, { method: "POST", credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  await readSseBody(res, onEvent);
}

/** POST + read an SSE body (transcript generate/revise/scene-chat streams). */
export async function streamSse(
  url: string,
  body: unknown,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  await readSseBody(res, onEvent);
}
