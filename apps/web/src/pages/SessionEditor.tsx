import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Scene, Transcript } from "@xyzstudio/shared";
import {
  api,
  streamSse,
  streamPresentationExport,
  type PresentationExportSseEvent,
} from "../api.js";

export default function SessionEditor() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ["session", id],
    queryFn: () => api.getSession(id),
  });
  const versions = useQuery({
    queryKey: ["versions", id],
    queryFn: () => api.listVersions(id),
  });
  const sceneSelections = useQuery({
    queryKey: ["scene-selections", id],
    queryFn: () => api.listSceneSelections(id),
    enabled: !!session.data?.latestVersion,
  });

  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [draft, setDraft] = useState<Transcript | null>(null);

  // Presentation export state
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [exportAssetId, setExportAssetId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["session", id] });
    void queryClient.invalidateQueries({ queryKey: ["versions", id] });
    void queryClient.invalidateQueries({ queryKey: ["scene-selections", id] });
  };

  async function runStream(url: string, body?: unknown) {
    setStreaming(true);
    setStreamText("");
    setError(null);
    setDraft(null);
    try {
      await streamSse(url, body, (event) => {
        if (event.type === "delta") setStreamText((t) => t + event.text);
        if (event.type === "error") setError(event.message);
        if (event.type === "complete") refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stream failed");
    } finally {
      setStreaming(false);
      setStreamText("");
    }
  }

  async function runPresentationExport() {
    setExporting(true);
    setExportProgress(null);
    setExportAssetId(null);
    setExportError(null);
    try {
      await streamPresentationExport(id, (event: PresentationExportSseEvent) => {
        if (event.type === "progress") {
          setExportProgress({ done: event.sceneIndex + 1, total: event.total });
        }
        if (event.type === "complete") {
          setExportAssetId(event.assetId);
          refresh();
        }
        if (event.type === "error") {
          setExportError(event.message);
        }
      });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const saveEdit = useMutation({
    mutationFn: (transcript: Transcript) => api.saveTranscriptEdit(id, transcript),
    onSuccess: () => {
      setDraft(null);
      refresh();
    },
  });

  if (session.isLoading) return <div className="centered">Loading…</div>;
  if (!session.data) return <div className="centered">Session not found.</div>;

  const s = session.data;
  const isPresentation = s.sessionType === "presentation";
  const transcript = draft ?? s.latestVersion?.content ?? null;
  const overBudget = !isPresentation && s.costPlan && s.costPlan.estimatedTotalUsd > s.budgetUsd;

  function updateScene(index: number, patch: Partial<Scene>) {
    if (!transcript) return;
    const next: Transcript = {
      ...transcript,
      scenes: transcript.scenes.map((sc) =>
        sc.index === index ? { ...sc, ...patch } : sc,
      ),
    };
    setDraft(next);
  }

  function toggleComplexAnimation(sceneIndex: number, current: boolean | undefined) {
    void api.editScene(id, sceneIndex, { complexAnimation: !current }).then(refresh);
  }

  return (
    <div className="editor">
      <section className="card">
        <h2>{s.title}</h2>
        <p className="muted">
          {isPresentation
            ? `presentation · ${s.language} · ${s.aspect} · theme: ${s.revealTheme ?? "white"} · status `
            : `${s.style} · ${s.language} · ${s.aspect} · voice ${s.voiceId} · budget $${s.budgetUsd} · status `}
          <em>{s.status}</em>
        </p>
        <p className="muted idea">{s.ideaPrompt}</p>

        {!isPresentation && (
          <div className="cost">
            {s.costPlan && (
              <span className={overBudget ? "warn" : ""}>
                Estimated cost: <strong>${s.costPlan.estimatedTotalUsd}</strong> /
                budget ${s.budgetUsd}
                {overBudget && " — over budget (soft target, allowed)"}
              </span>
            )}
            <span>
              Spent so far: <strong>${s.actualSpendUsd.toFixed(2)}</strong>
            </span>
          </div>
        )}

        {!s.latestVersion && (
          <button
            disabled={streaming}
            onClick={() => runStream(`/api/sessions/${id}/transcript/generate`)}
          >
            {streaming ? "Generating…" : "Generate transcript"}
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      {streaming && (
        <section className="card">
          <h3>Generating…</h3>
          <pre className="stream">{streamText || "Thinking…"}</pre>
        </section>
      )}

      {transcript && !streaming && (
        <>
          <section className="card">
            <h3>
              {transcript.title}{" "}
              <span className="muted">v{s.latestVersion?.version}</span>
            </h3>
            <p className="muted">{transcript.logline}</p>
            <table className="scenes">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Time</th>
                  <th>Narration</th>
                  <th>Visual description</th>
                  <th>Class</th>
                  {isPresentation ? <th>Complex anim.</th> : <th>Render</th>}
                </tr>
              </thead>
              <tbody>
                {transcript.scenes.map((scene) => {
                  const routing = s.costPlan?.perSceneRouting.find(
                    (r) => r.sceneIndex === scene.index,
                  );
                  const sel = sceneSelections.data?.find(
                    (sc) => sc.sceneIndex === scene.index,
                  );
                  return (
                    <tr key={scene.index}>
                      <td>
                        <Link
                          to={`/sessions/${id}/scene/${scene.index}`}
                          className="scene-link"
                        >
                          {scene.index}
                        </Link>
                      </td>
                      <td className="nowrap">
                        {scene.timestampStart}–{scene.timestampEnd}
                      </td>
                      <td>
                        <textarea
                          rows={3}
                          value={scene.narration}
                          onChange={(e) =>
                            updateScene(scene.index, { narration: e.target.value })
                          }
                        />
                      </td>
                      <td>
                        <textarea
                          rows={3}
                          value={scene.visualDescription}
                          onChange={(e) =>
                            updateScene(scene.index, {
                              visualDescription: e.target.value,
                            })
                          }
                        />
                      </td>
                      <td>{scene.sceneClass}</td>
                      {isPresentation ? (
                        <td>
                          <label className="complex-toggle">
                            <input
                              type="checkbox"
                              checked={!!scene.complexAnimation}
                              onChange={() =>
                                toggleComplexAnimation(scene.index, scene.complexAnimation)
                              }
                            />
                            {scene.complexAnimation ? " On" : " Off"}
                          </label>
                        </td>
                      ) : (
                        <td className="nowrap">
                          {routing
                            ? `${routing.renderPath}${routing.candidates > 1 ? ` ×${routing.candidates}` : ""} ($${routing.estimatedUsd.toFixed(2)})`
                            : "—"}
                          {sel?.selectedNarrationAssetId && (
                            <span className="sel-badge">narr ✓</span>
                          )}
                          {sel?.selectedVideoAssetId && (
                            <span className="sel-badge">vid ✓</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {draft && (
              <div className="row">
                <button
                  disabled={saveEdit.isPending}
                  onClick={() => saveEdit.mutate(draft)}
                >
                  Save edits as new version
                </button>
                <button className="link" onClick={() => setDraft(null)}>
                  Discard edits
                </button>
              </div>
            )}
            {saveEdit.error && <p className="error">{saveEdit.error.message}</p>}
          </section>

          {isPresentation && (
            <section className="card">
              <h3>Export presentation</h3>
              <p className="muted">
                Generates slides, CSS, and a zip you can download and screen-record.
              </p>
              {exportProgress && !exportAssetId && (
                <p className="muted">
                  Processing scene {exportProgress.done} / {exportProgress.total}…
                </p>
              )}
              {exportAssetId && (
                <p className="export-success">
                  Export complete.{" "}
                  <a
                    href={api.getPresentationZipUrl(id)}
                    download="presentation.zip"
                    className="download-link"
                  >
                    Download presentation.zip
                  </a>
                </p>
              )}
              {exportError && <p className="error">{exportError}</p>}
              <button
                disabled={exporting}
                onClick={() => void runPresentationExport()}
              >
                {exporting
                  ? exportProgress
                    ? `Exporting ${exportProgress.done}/${exportProgress.total}…`
                    : "Starting export…"
                  : exportAssetId
                    ? "Re-export"
                    : "Export"}
              </button>
            </section>
          )}

          <section className="card">
            <h3>Revise with feedback</h3>
            <textarea
              rows={3}
              placeholder={
                isPresentation
                  ? 'e.g. "Add a comparison slide between SQL and NoSQL after slide 3."'
                  : 'e.g. "Make the hook punchier and add a chart scene about latency."'
              }
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
            <button
              disabled={streaming || !feedback.trim()}
              onClick={() => {
                const f = feedback;
                setFeedback("");
                void runStream(`/api/sessions/${id}/transcript/revise`, {
                  feedback: f,
                });
              }}
            >
              Revise
            </button>
          </section>

          <section className="card">
            <h3>Version history</h3>
            <ul className="versions">
              {versions.data?.map((v) => (
                <li key={v.id}>
                  <strong>v{v.version}</strong> — {v.source}
                  {v.feedbackMessage && (
                    <span className="muted"> · "{v.feedbackMessage}"</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
