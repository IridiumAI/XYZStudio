import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Scene } from "@xyzstudio/shared";
import {
  api,
  streamSse,
  streamAssetSse,
  type SceneAsset,
  type SceneEditPatch,
} from "../api.js";

export default function SceneDeepDive() {
  const { id = "", sceneIndex = "0" } = useParams();
  const idx = parseInt(sceneIndex, 10);
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: ["session", id],
    queryFn: () => api.getSession(id),
  });
  const assetsQuery = useQuery({
    queryKey: ["scene-assets", id, idx],
    queryFn: () => api.getSceneAssets(id, idx),
    enabled: !!sessionQuery.data,
  });

  const [draft, setDraft] = useState<SceneEditPatch | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [generatingNarration, setGeneratingNarration] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const refreshSession = () =>
    void queryClient.invalidateQueries({ queryKey: ["session", id] });
  const refreshAssets = () =>
    void queryClient.invalidateQueries({ queryKey: ["scene-assets", id, idx] });

  const saveEdit = useMutation({
    mutationFn: (patch: SceneEditPatch) => api.editScene(id, idx, patch),
    onSuccess: () => {
      setDraft(null);
      refreshSession();
    },
  });

  const setSelection = useMutation({
    mutationFn: (sel: {
      narrationAssetId?: string | null;
      videoAssetId?: string | null;
    }) => api.setSceneSelection(id, idx, sel),
    onSuccess: () => refreshAssets(),
  });

  if (sessionQuery.isLoading) return <div className="centered">Loading…</div>;
  const s = sessionQuery.data;
  if (!s?.latestVersion)
    return <div className="centered">Session not found.</div>;

  const transcript = s.latestVersion.content;
  const scene = transcript.scenes.find((sc: Scene) => sc.index === idx);

  if (!scene) return <div className="centered">Scene {idx} not found.</div>;

  const routing = s.costPlan?.perSceneRouting.find(
    (r: { sceneIndex: number }) => r.sceneIndex === idx,
  );
  const effectiveScene: Scene = draft ? { ...scene, ...draft } : scene;
  const isDirty = draft !== null;

  const { narrationAssets = [], videoAssets = [], selection } =
    assetsQuery.data ?? {};
  const selectedNarrationId = selection?.selectedNarrationAssetId ?? null;
  const selectedVideoId = selection?.selectedVideoAssetId ?? null;

  function patchDraft(patch: SceneEditPatch) {
    setDraft((prev) => ({ ...(prev ?? {}), ...patch }));
  }

  async function sendChat() {
    const message = chatInput.trim();
    if (!message || streaming) return;
    setChatInput("");
    setStreaming(true);
    setStreamText("");
    setStreamError(null);
    try {
      await streamSse(
        `/api/sessions/${id}/scenes/${idx}/chat`,
        { message },
        (event) => {
          if (event.type === "delta") setStreamText((t) => t + event.text);
          if (event.type === "error") setStreamError(event.message);
          if (event.type === "complete") {
            refreshSession();
            setDraft(null);
          }
        },
      );
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setStreaming(false);
      setStreamText("");
    }
  }

  async function generateNarration() {
    setGeneratingNarration(true);
    setGenError(null);
    try {
      await streamAssetSse(
        `/api/sessions/${id}/scenes/${idx}/narration`,
        (event) => {
          if (event.type === "error") setGenError(event.message);
          if (event.type === "complete") refreshAssets();
        },
      );
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Narration generation failed");
    } finally {
      setGeneratingNarration(false);
    }
  }

  async function generateVideo() {
    setGeneratingVideo(true);
    setGenError(null);
    try {
      await streamAssetSse(
        `/api/sessions/${id}/scenes/${idx}/video`,
        (event) => {
          if (event.type === "error") setGenError(event.message);
          if (event.type === "complete") refreshAssets();
        },
      );
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Video generation failed");
    } finally {
      setGeneratingVideo(false);
    }
  }

  return (
    <div className="scene-dive">
      <div className="scene-dive-nav">
        <Link to={`/sessions/${id}`} className="back-link">
          ← Back to storyboard
        </Link>
        <span className="muted">
          Scene {idx} · {scene.timestampStart}–{scene.timestampEnd}
        </span>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Metadata + editing                                                  */}
      {/* ------------------------------------------------------------------ */}
      <section className="card">
        <h3>Scene metadata</h3>

        <div className="scene-meta-grid">
          <label className="meta-label">
            <span>Start</span>
            <input
              value={effectiveScene.timestampStart}
              onChange={(e) => patchDraft({ timestampStart: e.target.value })}
            />
          </label>
          <label className="meta-label">
            <span>End</span>
            <input
              value={effectiveScene.timestampEnd}
              onChange={(e) => patchDraft({ timestampEnd: e.target.value })}
            />
          </label>
          <label className="meta-label">
            <span>Class</span>
            <select
              value={effectiveScene.sceneClass}
              onChange={(e) =>
                patchDraft({ sceneClass: e.target.value as Scene["sceneClass"] })
              }
            >
              {(
                [
                  "diagram",
                  "chart",
                  "text",
                  "character",
                  "cinematic",
                  "hybrid",
                ] as const
              ).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div className="meta-label">
            <span>Render path</span>
            <span className="meta-value">
              {routing
                ? `${routing.renderPath}${routing.candidates > 1 ? ` ×${routing.candidates}` : ""} ($${routing.estimatedUsd.toFixed(2)})`
                : "—"}
            </span>
          </div>
        </div>

        <label className="meta-label" style={{ marginTop: "0.75rem" }}>
          <span>Narration</span>
          <textarea
            rows={4}
            value={effectiveScene.narration}
            onChange={(e) => patchDraft({ narration: e.target.value })}
          />
        </label>

        <label className="meta-label" style={{ marginTop: "0.75rem" }}>
          <span>Visual description</span>
          <textarea
            rows={4}
            value={effectiveScene.visualDescription}
            onChange={(e) => patchDraft({ visualDescription: e.target.value })}
          />
        </label>

        {isDirty && (
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button
              disabled={saveEdit.isPending}
              onClick={() => saveEdit.mutate(draft!)}
            >
              {saveEdit.isPending ? "Saving…" : "Save edits"}
            </button>
            <button className="link" onClick={() => setDraft(null)}>
              Discard
            </button>
          </div>
        )}
        {saveEdit.error && (
          <p className="error">{saveEdit.error.message}</p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Chat with AI                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section className="card">
        <h3>Chat with AI</h3>
        <p className="muted">
          Ask the AI to rewrite the narration, visual description, or adjust
          timing for this scene.
        </p>

        {streaming && streamText && (
          <pre className="stream">{streamText}</pre>
        )}
        {streamError && <p className="error">{streamError}</p>}

        <div className="chat-row">
          <textarea
            rows={2}
            placeholder='e.g. "Make the narration more punchy" or "Switch to a diagram showing latency"'
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                void sendChat();
              }
            }}
            disabled={streaming}
          />
          <button
            disabled={streaming || !chatInput.trim()}
            onClick={() => void sendChat()}
          >
            {streaming ? "Thinking…" : "Send"}
          </button>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Narration preview                                                   */}
      {/* ------------------------------------------------------------------ */}
      <section className="card">
        <div className="section-header">
          <h3>Narration preview</h3>
          <button
            disabled={generatingNarration || generatingVideo}
            onClick={() => void generateNarration()}
          >
            {generatingNarration ? "Generating…" : "Generate narration"}
          </button>
        </div>

        {genError && <p className="error">{genError}</p>}

        {narrationAssets.length === 0 ? (
          <p className="muted">No narration generated yet.</p>
        ) : (
          <ul className="asset-list">
            {narrationAssets.map((asset, i) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                label={`Take ${narrationAssets.length - i}`}
                isSelected={asset.id === selectedNarrationId}
                mediaType="audio"
                onSelect={() =>
                  setSelection.mutate({
                    narrationAssetId:
                      asset.id === selectedNarrationId ? null : asset.id,
                  })
                }
                selecting={setSelection.isPending}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Video preview                                                       */}
      {/* ------------------------------------------------------------------ */}
      <section className="card">
        <div className="section-header">
          <h3>Video preview</h3>
          <button
            disabled={generatingNarration || generatingVideo}
            onClick={() => void generateVideo()}
          >
            {generatingVideo ? "Generating…" : "Generate video"}
          </button>
        </div>

        {videoAssets.length === 0 ? (
          <p className="muted">No video generated yet.</p>
        ) : (
          <ul className="asset-list">
            {videoAssets.map((asset, i) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                label={`Take ${videoAssets.length - i}`}
                isSelected={asset.id === selectedVideoId}
                mediaType="video"
                onSelect={() =>
                  setSelection.mutate({
                    videoAssetId:
                      asset.id === selectedVideoId ? null : asset.id,
                  })
                }
                selecting={setSelection.isPending}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AssetRow({
  asset,
  label,
  isSelected,
  mediaType,
  onSelect,
  selecting,
}: {
  asset: SceneAsset;
  label: string;
  isSelected: boolean;
  mediaType: "audio" | "video";
  onSelect: () => void;
  selecting: boolean;
}) {
  const src = `/api/assets/${asset.id}`;
  const downloadSrc = `${src}?download=1`;
  const createdAt = new Date(asset.createdAt).toLocaleString();

  return (
    <li className={`asset-row${isSelected ? " asset-row--selected" : ""}`}>
      <div className="asset-meta">
        <strong>{label}</strong>
        {isSelected && <span className="selected-badge">Selected</span>}
        <span className="muted">{createdAt}</span>
      </div>
      {mediaType === "audio" ? (
        <audio controls src={src} className="asset-player" />
      ) : (
        <video controls src={src} className="asset-player" />
      )}
      <div className="asset-actions">
        <button
          className="link"
          disabled={selecting}
          onClick={onSelect}
        >
          {isSelected ? "Deselect" : "Select for scene"}
        </button>
        <a href={downloadSrc} download className="download-link">
          Download
        </a>
      </div>
    </li>
  );
}
