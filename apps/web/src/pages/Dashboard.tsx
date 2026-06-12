import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BUDGET_MAX_USD,
  BUDGET_MIN_USD,
  type CreateSessionInput,
} from "@xyzstudio/shared";
import { api } from "../api.js";

export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: api.listSessions });

  const [form, setForm] = useState({
    title: "",
    ideaPrompt: "",
    style: "cartoon" as CreateSessionInput["style"],
    language: "en" as CreateSessionInput["language"],
    aspect: "16x9" as CreateSessionInput["aspect"],
    voiceId: "",
    budgetUsd: 25,
  });

  const voices = useQuery({
    queryKey: ["voices", form.language],
    queryFn: () => api.listVoices(form.language),
  });
  const voiceId = form.voiceId || voices.data?.[0]?.id || "";

  const create = useMutation({
    mutationFn: () => api.createSession({ ...form, voiceId }),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      navigate(`/sessions/${session.id}`);
    },
  });

  return (
    <div className="dashboard">
      <section className="card">
        <h2>New video</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <input
            placeholder="Title"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <textarea
            placeholder='Describe your video idea… e.g. "A 5 min YouTube video about how to architect a stock exchange — informative, engaging, and funny, with a hook and a like & subscribe outro."'
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
          </div>
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
          {create.error && <p className="error">{create.error.message}</p>}
          <button type="submit" disabled={create.isPending || !voiceId}>
            Create session
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
                  {s.style} · {s.language} · {s.aspect} · ${s.budgetUsd} ·{" "}
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
