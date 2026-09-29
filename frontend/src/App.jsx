import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Database,
  FileCode2,
  GitBranch,
  Lightbulb,
  LoaderCircle,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  X,
} from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const PREFERENCE = "Our team prefers async/await instead of Promise chains.";
const FIRST_SAMPLE = `function getUser(id) {
  return db.findUser(id).then(user => {
    return user;
  });
}`;
const SECOND_SAMPLE = `function fetchOrders(userId) {
  return getUser(userId)
    .then(user => getOrders(user.id))
    .then(orders => orders);
}`;
const LANGUAGES = ["JavaScript", "TypeScript", "Python", "Go", "Rust", "Java", "C#", "Other"];

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    throw new Error("Could not reach the CodeMemory API. Check the backend URL and try again.");
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("The CodeMemory API route is not connected. Set VITE_API_PROXY_TARGET for local development.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function labelForMemory(memory) {
  const category = memory.metadata?.category;
  if (category === "team_preference") return "TEAM STANDARD";
  if (category?.startsWith("feedback_")) return "REVIEW FEEDBACK";
  if (category === "review_outcome") return "REVIEW HISTORY";
  return memory.context || "TEAM MEMORY";
}

function riskClass(risk) {
  return `risk risk-${risk || "low"}`;
}

function App() {
  const [tab, setTab] = useState("review");
  const [health, setHealth] = useState(null);
  const [memories, setMemories] = useState({ total: 0, items: [] });
  const [memoryStatus, setMemoryStatus] = useState("loading");
  const [reviews, setReviews] = useState([]);
  const [currentReview, setCurrentReview] = useState(null);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("JavaScript");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [demoStage, setDemoStage] = useState("");
  const [demoResults, setDemoResults] = useState(null);
  const [memoryDialog, setMemoryDialog] = useState(false);
  const [memoryText, setMemoryText] = useState("");
  const [evidence, setEvidence] = useState(null);

  async function refreshHealth() {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("The CodeMemory API route is not connected. Set VITE_API_PROXY_TARGET for local development.");
      }
      setHealth(await response.json());
    }
    catch (healthError) { setHealth({ status: "offline", error: healthError.message, integrations: {} }); }
  }

  async function refreshMemories() {
    try {
      const result = await api("/memory");
      setMemories({ total: Number.isInteger(result.total) ? result.total : 0, items: Array.isArray(result.items) ? result.items : [] });
      setMemoryStatus("available");
    } catch (requestError) {
      setMemoryStatus("unavailable");
      throw requestError;
    }
  }

  async function refreshReviews() {
    const result = await api("/reviews");
    setReviews(result.reviews || []);
  }

  useEffect(() => {
    refreshHealth();
    refreshMemories().catch(() => undefined);
    refreshReviews().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (tab === "memory") refreshMemories().catch((requestError) => setError(requestError.message));
    if (tab === "history") refreshReviews().catch((requestError) => setError(requestError.message));
  }, [tab]);

  async function submitReview(nextCode = code, nextLanguage = language) {
    const result = await api("/review", {
      method: "POST",
      body: JSON.stringify({ code: nextCode, language: nextLanguage }),
    });
    setCurrentReview(result);
    setDemoResults((existing) => existing?.before ? { ...existing, after: result } : null);
    await Promise.all([refreshMemories(), refreshReviews(), refreshHealth()]);
    return result;
  }

  async function handleReview(event) {
    event.preventDefault();
    setError("");
    setBusy("review");
    setDemoStage("");
    setDemoResults(null);
    try { await submitReview(); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(""); }
  }

  async function runDemo() {
    setError("");
    setBusy("demo");
    setTab("review");
    setLanguage("JavaScript");
    setDemoResults(null);
    setCurrentReview(null);
    try {
      setDemoStage("first");
      setCode(FIRST_SAMPLE);
      const before = await api("/review", {
        method: "POST",
        body: JSON.stringify({ code: FIRST_SAMPLE, language: "JavaScript" }),
      });
      setCurrentReview(before);
      setDemoResults({ before });
      setDemoStage("learning");
      await api("/memory", { method: "POST", body: JSON.stringify({ content: PREFERENCE }) });
      await refreshMemories();
      setDemoResults((result) => ({ ...result, learned: true }));
      setDemoStage("second");
      setCode(SECOND_SAMPLE);
      const after = await api("/review", {
        method: "POST",
        body: JSON.stringify({ code: SECOND_SAMPLE, language: "JavaScript" }),
      });
      setCurrentReview(after);
      setDemoResults((result) => ({ ...result, after }));
      setDemoStage("complete");
      await Promise.all([refreshMemories(), refreshReviews(), refreshHealth()]);
    } catch (requestError) {
      setDemoStage("failed");
      setError(requestError.message);
      refreshHealth();
    } finally {
      setBusy("");
    }
  }

  async function saveMemory(event) {
    event.preventDefault();
    setBusy("memory");
    setError("");
    try {
      await api("/memory", { method: "POST", body: JSON.stringify({ content: memoryText }) });
      setMemoryText("");
      setMemoryDialog(false);
      await Promise.all([refreshMemories(), refreshHealth()]);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(""); }
  }

  async function sendFeedback(targetType, index, decision) {
    if (!currentReview?.id) return;
    const key = `${targetType}-${index}`;
    setBusy(key);
    setError("");
    try {
      const result = await api("/memory/feedback", {
        method: "POST",
        body: JSON.stringify({ reviewId: currentReview.id, targetType, index, decision }),
      });
      setCurrentReview(result.review);
      await Promise.all([refreshMemories(), refreshHealth()]);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(""); }
  }

  async function openHistory(id) {
    setBusy(`history-${id}`);
    setError("");
    try {
      const review = await api(`/reviews/${encodeURIComponent(id)}`);
      setCurrentReview(review);
      setCode("");
      setTab("review");
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(""); }
  }

  const integrationReady = health?.status === "ready";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#review" onClick={(event) => { event.preventDefault(); setTab("review"); }} aria-label="CodeMemory home">
          <span className="brand-icon"><Code2 size={18} strokeWidth={2.2} /></span>
          <span>code<span className="brand-accent">memory</span></span>
        </a>
        <div className="workspace-label"><span className="workspace-dot" /> Engineering workspace <span className="workspace-divider">/</span> {health?.teamId || "demo-team"}</div>
        <div className={`connection-pill ${integrationReady ? "is-ready" : "is-down"}`} title={health?.error || "Integration status"}>
          <span className="connection-dot" />
          {integrationReady ? "Systems connected" : health?.status === "offline" ? "API unreachable" : "Setup required"}
        </div>
      </header>

      <div className="page-wrap">
        <section className="intro-row">
          <div>
            <div className="eyebrow"><span className="eyebrow-rule" /> TEAM-AWARE CODE REVIEW</div>
            <h1>Reviews that <span>remember.</span></h1>
            <p className="intro-copy">AI code review that learns your team's engineering standards.</p>
          </div>
          <button className="demo-button" type="button" onClick={runDemo} disabled={Boolean(busy)}>
            {busy === "demo" ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
            Load Demo Scenario
          </button>
        </section>

        <nav className="view-tabs" aria-label="Workspace views">
          <button className={tab === "review" ? "view-tab active" : "view-tab"} onClick={() => setTab("review")}><FileCode2 size={16} /> New review</button>
          <button className={tab === "memory" ? "view-tab active" : "view-tab"} onClick={() => setTab("memory")}><Database size={16} /> Team memory <span className="tab-count">{memoryStatus === "available" ? memories.total : "-"}</span></button>
          <button className={tab === "history" ? "view-tab active" : "view-tab"} onClick={() => setTab("history")}><Clock3 size={16} /> Review history <span className="tab-count">{reviews.length}</span></button>
          <div className="tab-spacer" />
          <div className="retain-recall-reflect"><span><i>01</i> RETAIN</span><span><i>02</i> RECALL</span><span><i>03</i> REFLECT</span></div>
        </nav>

        {error && <div className="error-banner" role="alert"><AlertCircle size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}

        {tab === "review" && (
          <>
            {demoResults && <DemoProgress stage={demoStage} results={demoResults} onOpenEvidence={setEvidence} />}
            {demoStage === "failed" && <p className="demo-note">The guided run stopped at the failed integration step. No memory or review result is shown unless Hindsight returned it.</p>}
            <main className="review-layout">
              <section className="editor-column">
                <div className="section-heading">
                  <div><span className="section-index">01</span><h2>Review a change</h2></div>
                  <span className="heading-note"><GitBranch size={14} /> Working tree</span>
                </div>
                <form className="editor-panel" onSubmit={handleReview}>
                  <div className="editor-toolbar">
                    <label className="language-label" htmlFor="language">Language</label>
                    <select id="language" value={language} onChange={(event) => setLanguage(event.target.value)} disabled={busy === "demo"}>
                      {LANGUAGES.map((item) => <option key={item}>{item}</option>)}
                    </select>
                    <span className="editor-separator" />
                    <span className="editor-mode"><FileCode2 size={14} /> Source</span>
                    <button className="clear-button" type="button" title="Clear editor" onClick={() => { setCode(""); setCurrentReview(null); setDemoResults(null); }}><RotateCcw size={14} /><span>Clear</span></button>
                  </div>
                  <div className="code-area-wrap">
                    <div className="line-gutter" aria-hidden="true">{(code || " ").split("\n").map((_, index) => <span key={index}>{String(index + 1).padStart(2, "0")}</span>)}</div>
                    <textarea
                      aria-label="Code to review"
                      className="code-input"
                      spellCheck="false"
                      autoCapitalize="off"
                      autoCorrect="off"
                      placeholder="Paste a code snippet or PR diff..."
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      disabled={busy === "demo"}
                    />
                  </div>
                  <div className="editor-footer">
                    <span><span className="footer-status-dot" /> {code.length.toLocaleString()} / 24,000 characters</span>
                    <button className="review-button" type="submit" disabled={Boolean(busy) || !code.trim()}>
                      {busy === "review" ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
                      Review Code <ArrowUpRight size={15} />
                    </button>
                  </div>
                </form>
                <div className="editor-caption"><ShieldAlert size={14} /><span>Source is sent to your configured review provider. Raw code is not retained in team memory.</span></div>

                <MemoryLedger memories={memories} loaded={memoryStatus === "available"} onTeach={() => setMemoryDialog(true)} loading={memoryStatus === "loading" || busy === "memory"} />
              </section>

              <section className="results-column">
                <div className="section-heading">
                  <div><span className="section-index">02</span><h2>Review findings</h2></div>
                  {currentReview && <span className="result-time">{new Date(currentReview.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                </div>
                {currentReview
                  ? <ReviewResult review={currentReview} busy={busy} onFeedback={sendFeedback} onOpenEvidence={setEvidence} />
                  : <EmptyReview connected={integrationReady} onTryDemo={runDemo} busy={Boolean(busy)} />}
              </section>
            </main>
          </>
        )}

        {tab === "memory" && <MemoryPage memories={memories} available={memoryStatus === "available"} onTeach={() => setMemoryDialog(true)} />}
        {tab === "history" && <HistoryPage reviews={reviews} onOpen={openHistory} busy={busy} />}

        <footer className="page-footer"><span>CODEMEMORY <i>·</i> BUILT ON HINDSIGHT</span><span>Persistent team context for every review.</span></footer>
      </div>

      {memoryDialog && <MemoryDialog value={memoryText} onChange={setMemoryText} onClose={() => setMemoryDialog(false)} onSave={saveMemory} busy={busy === "memory"} />}
      {evidence && <EvidenceDialog recommendation={evidence.recommendation} sources={evidence.sources} onClose={() => setEvidence(null)} />}
    </div>
  );
}

function DemoProgress({ stage, results, onOpenEvidence }) {
  const steps = [
    { id: "first", title: "Generic review", icon: <Code2 size={14} /> },
    { id: "learning", title: "Preference retained", icon: <Database size={14} /> },
    { id: "second", title: "Team-aware review", icon: <Sparkles size={14} /> },
  ];
  const done = stage === "complete";
  return (
    <section className={`demo-journey ${done ? "demo-complete" : ""}`} aria-label="Guided demo progress">
      <div className="journey-topline">
        <div><Sparkles size={15} /><span>{done ? "GUIDED RUN COMPLETE" : stage === "failed" ? "GUIDED RUN PAUSED" : "LIVE HINDSIGHT WALKTHROUGH"}</span></div>
        <span className="journey-live"><i /> {done ? "Actual Hindsight memories" : "Processing real API calls"}</span>
      </div>
      <div className="journey-steps">
        {steps.map((step, index) => {
          const isDone = done || (stage === "learning" && index === 0) || (stage === "second" && index < 2);
          const isActive = step.id === stage;
          return <div className={`journey-step ${isDone ? "step-done" : ""} ${isActive ? "step-active" : ""}`} key={step.id}>
            <span className="step-icon">{isDone ? <Check size={14} /> : step.icon}</span><span>{step.title}</span>
          </div>;
        })}
      </div>
      {results?.before && <div className="demo-compare">
        <div className="compare-side"><span className="compare-label">BEFORE MEMORY</span><p>{results.before.summary}</p></div>
        <div className="compare-arrow"><ArrowDownLeft size={15} /></div>
        <div className="compare-side compare-after">
          <span className="compare-label">AFTER HINDSIGHT RECALL</span>
          {results.after
            ? <><p>{results.after.teamSpecificRecommendations?.[0]?.recommendation || results.after.summary}</p>
              {results.after.teamSpecificRecommendations?.[0] && <button className="inline-evidence" onClick={() => {
                const recommendation = results.after.teamSpecificRecommendations[0];
                onOpenEvidence({ recommendation: recommendation.recommendation, sources: results.after.memorySources.filter((item) => recommendation.memoryIds.includes(item.id)) });
              }}><CircleHelp size={13} /> Evidence</button>}</>
            : <p className="compare-pending">{results.learned ? "Preference stored. Reviewing similar code..." : "Team preference will appear here once retained."}</p>}
        </div>
      </div>}
    </section>
  );
}

function MemoryLedger({ memories, loaded, onTeach, loading }) {
  const visible = loaded ? memories.items.slice(0, 4) : [];
  return <section className="memory-ledger">
    <div className="ledger-head">
      <div className="ledger-title"><span className="ledger-icon"><Database size={16} /></span><div><h3>Team memory</h3><p>Standards that shape future reviews</p></div></div>
      <span className="memory-count">{loaded ? memories.total : "-"} <small>{loaded ? "stored" : "status unknown"}</small></span>
    </div>
    {visible.length ? <div className="ledger-list">{visible.map((item) => <div className="ledger-item" key={item.id || `${item.text}-${item.createdAt}`}>
      <span className="memory-bullet" /><div><p>{item.text}</p><span>{labelForMemory(item)}</span></div>
    </div>)}</div> : <div className="ledger-empty">{loading ? <LoaderCircle size={15} className="spin" /> : loaded ? <Lightbulb size={15} /> : <AlertCircle size={15} />}<span>{loading ? "Connecting to Hindsight..." : loaded ? "No team standards yet. Teach CodeMemory a preference to get started." : "Hindsight has not returned the team memory bank."}</span></div>}
    <div className="ledger-footer"><button onClick={onTeach}><Plus size={14} /> Teach a standard</button><span>via Hindsight</span></div>
  </section>;
}

function EmptyReview({ connected, onTryDemo, busy }) {
  return <div className="empty-review">
    <div className="empty-glyph"><Code2 size={24} /><span /></div>
    <h3>Your next review starts here.</h3>
    <p>Paste a change to get a focused review. As your team teaches preferences, Hindsight brings them into future recommendations.</p>
    <div className="empty-sequence"><span><b>01</b> Submit code</span><ChevronRight size={13} /><span><b>02</b> Teach a preference</span><ChevronRight size={13} /><span><b>03</b> See it recalled</span></div>
    {!connected && <span className="offline-note"><AlertCircle size={13} /> Backend integrations need setup before reviewing.</span>}
    <button className="empty-demo-link" onClick={onTryDemo} disabled={busy}><Sparkles size={14} /> Run the guided scenario</button>
  </div>;
}

function ReviewResult({ review, busy, onFeedback, onOpenEvidence }) {
  return <div className="review-result">
    <div className="result-overview">
      <div className="overview-top"><span className="result-kicker"><CheckCheck size={14} /> REVIEW COMPLETE</span><span className={riskClass(review.overallRisk)}><i /> {review.overallRisk} risk</span></div>
      <p className="result-summary">{review.summary}</p>
      <div className="result-meta"><span><FileCode2 size={13} /> {review.language}</span><span>{review.issues?.length || 0} findings</span><span>{review.memorySources?.length || 0} memories recalled</span></div>
    </div>

    {review.parseWarning && <div className="parse-warning"><AlertCircle size={15} /> {review.parseWarning}</div>}

    {review.teamSpecificRecommendations?.length > 0 && <section className="team-recommendations">
      <div className="recommendation-heading"><span className="sparkle-mark"><Sparkles size={15} /></span><div><span>FROM YOUR TEAM'S MEMORY</span><h3>Team-specific recommendation</h3></div><span className="memory-grounded"><Database size={12} /> HINDSIGHT</span></div>
      {review.teamSpecificRecommendations.map((item, index) => {
        const sources = review.memorySources.filter((source) => item.memoryIds.includes(source.id));
        const feedback = review.feedback?.find((record) => record.targetType === "team_recommendation" && record.index === index);
        return <div className="recommendation-body" key={`${item.recommendation}-${index}`}>
          <p className="recommendation-text">{item.recommendation}</p><p className="recommendation-reason">{item.reason}</p>
          <div className="recommendation-actions"><button className="why-button" onClick={() => onOpenEvidence({ recommendation: item.recommendation, sources })}><CircleHelp size={14} /> Why this recommendation?</button>
            <FeedbackActions feedback={feedback} busy={busy === `team_recommendation-${index}`} onAccept={() => onFeedback("team_recommendation", index, "accepted")} onReject={() => onFeedback("team_recommendation", index, "rejected")} />
          </div>
        </div>;
      })}
    </section>}

    <section className="issue-section">
      <div className="issue-section-head"><h3>Findings</h3><span>{review.issues?.length || 0}</span></div>
      {review.issues?.length ? review.issues.map((issue, index) => {
        const feedback = review.feedback?.find((record) => record.targetType === "issue" && record.index === index);
        return <article className="issue-item" key={`${issue.title}-${index}`}>
          <div className="issue-title-row"><span className={`severity severity-${issue.severity}`}><i /> {issue.severity}</span>{issue.line && <span className="line-ref">Ln {issue.line}</span>}</div>
          <h4>{issue.title}</h4><p>{issue.description}</p>
          {issue.recommendation && <div className="issue-recommendation"><span>RECOMMENDATION</span><p>{issue.recommendation}</p></div>}
          <FeedbackActions feedback={feedback} busy={busy === `issue-${index}`} onAccept={() => onFeedback("issue", index, "accepted")} onReject={() => onFeedback("issue", index, "rejected")} />
        </article>;
      }) : <div className="no-issues"><Check size={15} /> No actionable findings in this review.</div>}
    </section>

    <MemoryEvidence sources={review.memorySources || []} reflection={review.memoryReflection} />
  </div>;
}

function FeedbackActions({ feedback, busy, onAccept, onReject }) {
  if (feedback) return <span className={`feedback-saved feedback-${feedback.decision}`}><Check size={13} /> {feedback.decision === "accepted" ? "Accepted" : "Rejected"} · learned</span>;
  return <div className="feedback-actions">
    <button title="Accept this recommendation and remember the outcome" disabled={busy} onClick={onAccept}>{busy ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />} Accept</button>
    <button title="Reject this recommendation and remember the outcome" disabled={busy} onClick={onReject}><ThumbsDown size={13} /> Reject</button>
  </div>;
}

function MemoryEvidence({ sources, reflection }) {
  const [expanded, setExpanded] = useState(false);
  return <section className="memory-evidence">
    <button className="evidence-toggle" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
      <span><Database size={14} /> Hindsight memory used</span><span>{sources.length} sources <ChevronRight className={expanded ? "chevron-open" : ""} size={14} /></span>
    </button>
    {expanded && <div className="evidence-content">
      {sources.length ? <>
        <p>These records were returned by Hindsight before this review.</p>
        {sources.map((source, index) => <div className="evidence-source" key={source.id || index}><span className="source-index">{String(index + 1).padStart(2, "0")}</span><div><p>{source.text}</p><span>{source.context || labelForMemory(source)}</span></div></div>)}
        {reflection && <details className="reflection-detail"><summary>Hindsight reflection</summary><p>{reflection}</p></details>}
      </> : <p>No relevant Hindsight memories were returned. This result is a generic code review.</p>}
    </div>}
  </section>;
}

function MemoryPage({ memories, available, onTeach }) {
  return <main className="wide-page">
    <div className="wide-heading"><div><span className="section-index">03</span><h2>Team memory</h2></div><button className="primary-small" onClick={onTeach}><Plus size={15} /> Teach a standard</button></div>
    <section className="memory-page-intro"><span className="memory-page-icon"><Database size={20} /></span><div><h3>{available ? `${memories.total} memories in this team's Hindsight bank` : "Hindsight bank unavailable"}</h3><p>{available ? "Preferences and review outcomes retained for future retrieval. Entries shown here come from the configured Hindsight API." : "A memory count and contents will appear after the configured Hindsight API responds."}</p></div>{available && <span className="live-bank"><i /> LIVE BANK</span>}</section>
    {!available ? <div className="memory-empty-state"><AlertCircle size={23} /><h3>Memory status unknown</h3><p>CodeMemory cannot confirm whether this team's bank is empty until Hindsight responds.</p></div> : memories.items.length ? <div className="memory-grid">{memories.items.map((memory, index) => <article className="memory-card" key={memory.id || `${memory.text}-${index}`}>
      <div className="memory-card-head"><span className="memory-kind"><i /> {labelForMemory(memory)}</span><span className="memory-number">{String(index + 1).padStart(2, "0")}</span></div>
      <p>{memory.text || "Memory text unavailable"}</p>
      <div className="memory-card-meta"><span>{memory.context || "Hindsight memory"}</span>{memory.createdAt && <time>{new Date(memory.createdAt).toLocaleDateString()}</time>}</div>
    </article>)}</div> : <div className="memory-empty-state"><Lightbulb size={23} /><h3>Nothing retained yet</h3><p>Teach a preference after your first review. It will be stored in Hindsight and available to future reviews.</p><button className="primary-small" onClick={onTeach}><Plus size={15} /> Add a team standard</button></div>}
  </main>;
}

function HistoryPage({ reviews, onOpen, busy }) {
  return <main className="wide-page">
    <div className="wide-heading"><div><span className="section-index">04</span><h2>Review history</h2></div><span className="history-saved"><Database size={14} /> Stored locally</span></div>
    <div className="history-table-wrap">
      {reviews.length ? <table className="history-table"><thead><tr><th>REVIEW</th><th>LANGUAGE</th><th>RISK</th><th>FINDINGS</th><th>MEMORY</th><th>TIME</th><th /></tr></thead><tbody>
        {reviews.map((review) => <tr key={review.id}>
          <td><span className="history-summary">{review.summary}</span><small>{review.id.slice(0, 8)}</small></td>
          <td>{review.language}</td><td><span className={riskClass(review.overallRisk)}><i /> {review.overallRisk}</span></td>
          <td>{review.issues?.length || 0}</td><td><span className="history-memory-count"><Database size={13} /> {review.teamSpecificRecommendations?.length || 0}</span></td>
          <td>{new Date(review.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td>
          <td><button className="open-review" onClick={() => onOpen(review.id)} disabled={busy === `history-${review.id}`}>{busy === `history-${review.id}` ? <LoaderCircle size={14} className="spin" /> : <ChevronRight size={15} />}</button></td>
        </tr>)}
      </tbody></table> : <div className="history-empty"><Clock3 size={22} /><h3>No reviews yet</h3><p>Completed reviews will be saved here for this installation.</p></div>}
    </div>
  </main>;
}

function MemoryDialog({ value, onChange, onClose, onSave, busy }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="memory-dialog-title" onSubmit={onSave}>
      <button className="modal-close" type="button" onClick={onClose} aria-label="Close"><X size={17} /></button>
      <span className="modal-icon"><Lightbulb size={19} /></span><span className="modal-eyebrow">TEAM STANDARD</span>
      <h2 id="memory-dialog-title">What should the team remember?</h2>
      <p>CodeMemory retains this in Hindsight so relevant future reviews can use it.</p>
      <textarea autoFocus value={value} onChange={(event) => onChange(event.target.value)} maxLength={1600} placeholder={'Our team prefers early returns over deeply nested conditionals.'} required />
      <div className="modal-foot"><span>{value.length} / 1,600</span><button className="primary-small" disabled={busy || !value.trim()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Database size={15} />} Save to Team Memory</button></div>
    </form>
  </div>;
}

function EvidenceDialog({ recommendation, sources, onClose }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card evidence-modal" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
      <button className="modal-close" type="button" onClick={onClose} aria-label="Close"><X size={17} /></button>
      <span className="modal-icon evidence-icon"><CircleHelp size={19} /></span><span className="modal-eyebrow">RECOMMENDATION EVIDENCE</span>
      <h2 id="evidence-title">Why this recommendation?</h2><p className="evidence-quote">“{recommendation}”</p>
      <div className="evidence-modal-list"><span className="evidence-list-label">RETURNED BY HINDSIGHT BEFORE THIS REVIEW</span>
        {sources.length ? sources.map((source, index) => <div className="evidence-source" key={source.id || index}><Check size={14} /><div><p>{source.text}</p><span>{source.context || "Hindsight memory"}</span></div></div>) : <p className="no-evidence">No source records were returned for this recommendation.</p>}
      </div>
      <button className="modal-done" onClick={onClose}>Close</button>
    </section>
  </div>;
}

export default App;
