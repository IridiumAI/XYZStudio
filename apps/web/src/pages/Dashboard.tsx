import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BUDGET_MAX_USD,
  BUDGET_MIN_USD,
  DEFAULT_STYLE_PROMPT,
  DEFAULT_REVEAL_THEME,
  DEFAULT_IMAGE_PROVIDER,
  type CreateSessionInput,
  type CreatePresentationSessionInput,
} from "@xyzstudio/shared";
import { api } from "../api.js";

type SessionType = "video" | "presentation";

export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: api.listSessions });

  const [sessionType, setSessionType] = useState<SessionType>("video");
  const [form, setForm] = useState({
    title: "",
    ideaPrompt: "",
    style: "cartoon" as CreateSessionInput["style"],
    language: "en" as CreateSessionInput["language"],
    aspect: "16x9" as CreateSessionInput["aspect"],
    voiceId: "",
    budgetUsd: 25,
    // presentation-only
    stylePrompt: DEFAULT_STYLE_PROMPT,
    revealTheme: DEFAULT_REVEAL_THEME as CreatePresentationSessionInput["revealTheme"],
    imageProvider: DEFAULT_IMAGE_PROVIDER as CreatePresentationSessionInput["imageProvider"],
  });

  const voices = useQuery({
    queryKey: ["voices", form.language],
    queryFn: () => api.listVoices(form.language),
    enabled: sessionType === "video",
  });
  const voiceId = form.voiceId || voices.data?.[0]?.id || "";

  const createVideo = useMutation({
    mutationFn: () =>
      api.createSession({
        title: form.title,
        ideaPrompt: form.ideaPrompt,
        style: form.style,
        language: form.language,
        aspect: form.aspect,
        voiceId,
        budgetUsd: form.budgetUsd,
      }),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      navigate(`/sessions/${session.id}`);
    },
  });

  const createPresentation = useMutation({
    mutationFn: () =>
      api.createPresentationSession({
        sessionType: "presentation",
        title: form.title,
        ideaPrompt: form.ideaPrompt,
        style: form.style,
        language: form.language,
        aspect: form.aspect,
        stylePrompt: form.stylePrompt,
        revealTheme: form.revealTheme,
        imageProvider: form.imageProvider,
      }),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      navigate(`/sessions/${session.id}`);
    },
  });

  const isPending = createVideo.isPending || createPresentation.isPending;
  const createError = createVideo.error ?? createPresentation.error;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sessionType === "presentation") {
      createPresentation.mutate();
    } else {
      createVideo.mutate();
    }
  }

  return (
    <div className="dashboard">
      <section className="card">
        <h2>{sessionType === "presentation" ? "New presentation" : "New video"}</h2>

        <div className="type-toggle" role="group" aria-label="Session type">
          <button
            type="button"
            className={sessionType === "video" ? "toggle-btn active" : "toggle-btn"}
            onClick={() => setSessionType("video")}
          >
            Video
          </button>
          <button
            type="button"
            className={sessionType === "presentation" ? "toggle-btn active" : "toggle-btn"}
            onClick={() => setSessionType("presentation")}
          >
            Presentation
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            placeholder="Title"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <textarea
            placeholder={
              sessionType === "presentation"
                ? 'e.g. "A 10-slide explainer on how to architect a stock exchange — informative and funny, with a hook slide and a Q&A slide."'
                : 'e.g. "A 5 min YouTube video about how to architect a stock exchange — informative, engaging, and funny, with a hook and a like & subscribe outro."'
            }
            required
            rows={5}
            value={form.ideaPrompt}
            onChange={(e) => setForm({ ...form, ideaPrompt: e.target.value })}
          />

          <div className="row">
            <label>
              Style
              <select
                value={form.style}
                onChange={(e) =>
                  setForm({ ...form, style: e.target.value as typeof form.style })
                }
              >
                <option value="cartoon">Animated cartoon</option>
                <option value="whiteboard">Whiteboard explainer</option>
              </select>
            </label>
            <label>
              Language
              <select
                value={form.language}
                onChange={(e) =>
                  setForm({
                    ...form,
                    language: e.target.value as typeof form.language,
                    voiceId: "",
                  })
                }
              >
                <option value="en">English</option>
                <option value="zh-Hans">中文（简体）</option>
              </select>
            </label>
            <label>
              Aspect
              <select
                value={form.aspect}
                onChange={(e) =>
                  setForm({ ...form, aspect: e.target.value as typeof form.aspect })
                }
              >
                <option value="16x9">16:9 (YouTube, 1080p)</option>
                <option value="9x16">9:16 (TikTok/Shorts)</option>
              </select>
            </label>
            {sessionType === "video" && (
              <label>
                Voice
                <select
                  value={voiceId}
                  onChange={(e) => setForm({ ...form, voiceId: e.target.value })}
                >
                  {(voices.data ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {sessionType === "video" && (
            <label className="budget">
              Budget: <strong>${form.budgetUsd}</strong>
              <input
                type="range"
                min={BUDGET_MIN_USD}
                max={BUDGET_MAX_USD}
                step={1}
                value={form.budgetUsd}
                onChange={(e) => setForm({ ...form, budgetUsd: Number(e.target.value) })}
              />
              <span className="muted">
                Low budgets render scenes programmatically; higher budgets buy
                generative video for character scenes. Soft target — you can exceed
                it with a warning.
              </span>
            </label>
          )}

          {sessionType === "presentation" && (
            <>
              <label>
                Slide image style
                <textarea
                  rows={3}
                  value={form.stylePrompt}
                  onChange={(e) => setForm({ ...form, stylePrompt: e.target.value })}
                />
                <span className="muted">
                  Drives both generated images and CSS colour overrides. Leave default
                  for a clean tech-vector look.
                </span>
              </label>
              <div className="row">
                <label>
                  Reveal.js theme
                  <select
                    value={form.revealTheme}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        revealTheme: e.target.value as typeof form.revealTheme,
                      })
                    }
                  >
                    <option value="white">White</option>
                    <option value="black">Black</option>
                    <option value="moon">Moon</option>
                    <option value="night">Night</option>
                    <option value="sky">Sky</option>
                    <option value="beige">Beige</option>
                    <option value="simple">Simple</option>
                  </select>
                </label>
                <label>
                  Image generator
                  <select
                    value={form.imageProvider}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        imageProvider: e.target.value as typeof form.imageProvider,
                      })
                    }
                  >
                    <option value="openai">OpenAI (default)</option>
                    <option value="gemini-nano">Gemini Nano</option>
                    <option value="gemini-flash">Gemini Flash</option>
                    <option value="gemini-pro">Gemini Pro</option>
                  </select>
                </label>
              </div>
            </>
          )}

          {createError && <p className="error">{createError.message}</p>}
          <button
            type="submit"
            disabled={isPending || (sessionType === "video" && !voiceId)}
          >
            {isPending
              ? "Creating…"
              : sessionType === "presentation"
                ? "Create presentation"
                : "Create session"}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Your sessions</h2>
        {sessions.isLoading && <p className="muted">Loading…</p>}
        {sessions.data?.length === 0 && <p className="muted">No sessions yet.</p>}
        <ul className="session-list">
          {sessions.data?.map((s) => (
            <li key={s.id}>
              <Link to={`/sessions/${s.id}`}>
                <strong>{s.title}</strong>
                <span className="muted">
                  {s.sessionType === "presentation" ? "presentation" : s.style} ·{" "}
                  {s.language} · {s.aspect}
                  {s.sessionType === "video" && ` · $${s.budgetUsd}`} ·{" "}
                  <em>{s.status}</em>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
