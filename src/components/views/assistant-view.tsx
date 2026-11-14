"use client";

/**
 * Assistant — vue la plus importante : conversation (2/3) + panneau mission (1/3).
 * SSE réel (response.body.getReader()), transcription vocale réelle (MediaRecorder),
 * sources cliquables vers la vue Fichiers. Aucun artifice, aucun setTimeout de streaming.
 */
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { apiGet } from "@/hooks/use-api";
import { toast } from "@/hooks/use-toast";
import { useAppStore, refreshCredits } from "@/store/app";
import { EtatErreur } from "@/components/app/etat-erreur";
import { Pill } from "@/components/app/pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mic, Plus, Square, FileText, Clock } from "lucide-react";

type SourceRef = { fileId: string; label: string; page?: number; ref?: string };

type ChatMessage = {
  id: string;
  role: string;
  content: string;
  sources: SourceRef[];
  taskId: string | null;
  createdAt: string;
  statut?: string;
};

type StepItem = { no: number; label: string; statut: string };

type ToolItem = {
  tool: string;
  paramsSummary: string;
  resultSummary: string;
  ok?: boolean;
  ms?: number;
  proof?: string;
};

type Mission = {
  active: boolean;
  taskId: string | null;
  objectif: string;
  criteres: string;
  steps: StepItem[];
  tools: ToolItem[];
  sources: SourceRef[];
  statut: string | null;
};

type TaskHist = {
  id: string;
  objectif: string;
  statut: string;
  steps: StepItem[];
  toolCalls: { tool: string; paramsSummary: string; resultSummary: string; ms: number }[];
  sources: SourceRef[];
  finishedAt: string | null;
};

type Conversation = { id: string; title: string; createdAt: string; lastMessage: string };

type AgentEvent =
  | { type: "mission"; taskId: string; objectif: string; criteres: string }
  | { type: "etape"; no: number; label: string; statut: "FAIT" | "EN_COURS" | "ECHEC" }
  | { type: "outil"; tool: string; paramsSummary: string; resultSummary: string; ok: boolean; ms: number; proof?: string }
  | { type: "sources"; sources: SourceRef[] }
  | { type: "clarification"; question: string; options?: string[] }
  | { type: "reponse"; content: string; statut: string; sources: SourceRef[] }
  | { type: "erreur"; message: string }
  | { type: "fin"; conversationId: string };

const EMPTY_MISSION: Mission = { active: false, taskId: null, objectif: "", criteres: "", steps: [], tools: [], sources: [], statut: null };

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </h3>
  );
}

/** Croix d'erreur : deux barres, même vocabulaire de formes que les pastilles du cachet. */
function CrossMark({ color }: { color: string }) {
  return (
    <span className="relative h-2 w-2 shrink-0" aria-hidden="true">
      <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2" style={{ background: color }} />
      <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2" style={{ background: color }} />
    </span>
  );
}

function statutPill(statut: string, label: string) {
  switch (statut) {
    case "REUSSIE":
    case "APPROUVEE":
      return <Pill tone="ruban" shape="dot" label={label} />;
    case "PARTIELLEMENT_REUSSIE":
    case "EN_ATTENTE_UTILISATEUR":
    case "EN_ATTENTE":
      return <Pill tone="carton" shape="ring" label={label} />;
    case "ECHEC":
    case "REFUSEE":
      return <Pill tone="erreur" shape="cross" label={label} />;
    default:
      return <Pill tone="encre" shape="dot" label={label} />;
  }
}

export function AssistantView() {
  const { t } = useI18n();
  const setDetailFileId = useAppStore((s) => s.setDetailFileId);
  const setView = useAppStore((s) => s.setView);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convErreur, setConvErreur] = useState(false);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mission, setMission] = useState<Mission>(EMPTY_MISSION);
  const [clarification, setClarification] = useState<{ question: string; options: string[] } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [queue, setQueue] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const convIdRef = useRef<string | null>(null);
  const missionActiveRef = useRef(false);
  const queueRef = useRef<string[]>([]);
  const clarificationRef = useRef<{ question: string; options: string[] } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const refreshConversations = async () => {
    const data = await apiGet<{ conversations: Conversation[] }>("/api/agent/chat");
    if (data?.conversations) {
      setConversations(data.conversations);
      setConvErreur(false);
    } else {
      setConvErreur(true);
    }
  };

  useEffect(() => {
    let vivant = true;
    (async () => {
      const data = await apiGet<{ conversations: Conversation[] }>("/api/agent/chat");
      if (!vivant) return;
      if (data?.conversations) {
        setConversations(data.conversations);
        setConvErreur(false);
      } else {
        setConvErreur(true);
      }
    })();
    return () => {
      vivant = false;
    };
  }, []);

  // Défilement réel du fil : ancré en bas à chaque nouveau contenu
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, clarification, erreur, queue]);

  useEffect(() => {
    // relâche propre du micro si la vue est démontée pendant l'enregistrement
    const recorder = recorderRef.current;
    return () => {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    };
  }, []);

  const openSource = (fileId: string) => {
    setDetailFileId(fileId);
    setView("files");
  };

  const pushUserMessage = (text: string) => {
    setMessages((m) => [...m, { id: `local-u-${Date.now()}-${m.length}`, role: "user", content: text, sources: [], taskId: null, createdAt: new Date().toISOString() }]);
  };

  function applyEvent(event: AgentEvent) {
    switch (event.type) {
      case "mission":
        setMission((m) => ({ ...m, taskId: event.taskId, objectif: event.objectif, criteres: event.criteres }));
        break;
      case "etape":
        setMission((m) => {
          const steps = [...m.steps];
          const idx = steps.findIndex((s) => s.no === event.no);
          if (idx >= 0) steps[idx] = { no: event.no, label: event.label, statut: event.statut };
          else steps.push({ no: event.no, label: event.label, statut: event.statut });
          return { ...m, steps };
        });
        break;
      case "outil":
        setMission((m) => ({
          ...m,
          tools: [...m.tools, { tool: event.tool, paramsSummary: event.paramsSummary, resultSummary: event.resultSummary, ok: event.ok, ms: event.ms, proof: event.proof }],
        }));
        break;
      case "sources":
        setMission((m) => {
          const merged = [...m.sources];
          for (const s of event.sources) if (!merged.some((x) => x.fileId === s.fileId)) merged.push(s);
          return { ...m, sources: merged.slice(0, 20) };
        });
        break;
      case "clarification":
        clarificationRef.current = { question: event.question, options: event.options ?? [] };
        setClarification({ question: event.question, options: event.options ?? [] });
        break;
      case "reponse": {
        // Si la question de clarification est renvoyée telle quelle, la bulle de clarification fait foi (pas de doublon)
        const cl = clarificationRef.current;
        if (!(cl && event.content.trim() === cl.question.trim())) {
          setMessages((m) => [...m, { id: `local-a-${Date.now()}-${m.length}`, role: "assistant", content: event.content, sources: event.sources ?? [], taskId: null, createdAt: new Date().toISOString(), statut: event.statut }]);
        }
        setMission((m) => {
          const merged = [...m.sources];
          for (const s of event.sources ?? []) if (!merged.some((x) => x.fileId === s.fileId)) merged.push(s);
          return { ...m, statut: event.statut, sources: merged.slice(0, 20) };
        });
        break;
      }
      case "erreur":
        setErreur(event.message);
        break;
      case "fin":
        convIdRef.current = event.conversationId;
        setActiveConvId((cur) => cur ?? event.conversationId);
        setMission((m) => ({ ...m, active: false }));
        void refreshConversations();
        void refreshCredits();
        break;
    }
  }

  function drainQueue() {
    const [next, ...rest] = queueRef.current;
    if (!next) return;
    queueRef.current = rest;
    setQueue(rest);
    pushUserMessage(next);
    void runMission(next);
  }

  /** Mission réelle : POST + lecture SSE du corps de la réponse, événement par événement. */
  async function runMission(text: string) {
    missionActiveRef.current = true;
    setMission({ ...EMPTY_MISSION, active: true, objectif: text });
    setClarification(null);
    clarificationRef.current = null;
    setErreur(null);
    let closed = false;
    const conclude = () => {
      if (closed) return;
      closed = true;
      missionActiveRef.current = false;
      setMission((m) => ({ ...m, active: false }));
      drainQueue();
    };
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId: convIdRef.current ?? undefined }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast({ title: t("common.error"), description: data.error ?? t("common.errorNetwork"), variant: "destructive" });
        conclude();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            applyEvent(JSON.parse(line.slice(6)) as AgentEvent);
          } catch {
            // segment SSE illisible : ignoré sans interrompre la mission
          }
        }
      }
    } catch {
      toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
    } finally {
      conclude();
    }
  }

  function send(raw: string) {
    const text = raw.trim();
    if (!text) return;
    setInput("");
    if (missionActiveRef.current) {
      // mise en file visuelle : la mission en cours reste prioritaine
      queueRef.current = [...queueRef.current, text];
      setQueue(queueRef.current);
      return;
    }
    pushUserMessage(text);
    void runMission(text);
  }

  const loadConversation = async (id: string) => {
    setActiveConvId(id);
    convIdRef.current = id;
    const data = await apiGet<{ messages: ChatMessage[]; tasks: TaskHist[] }>(`/api/agent/conversations/${id}/messages`);
    if (!data) return;
    const tasksById = new Map(data.tasks.map((tk) => [tk.id, tk]));
    setMessages(data.messages.map((m) => ({ ...m, sources: m.sources ?? [], statut: m.taskId ? tasksById.get(m.taskId)?.statut : undefined })));
    // restaurer le panneau mission avec le dernier statut réel de la conversation
    const lastMsgWithTask = [...data.messages].reverse().find((m) => m.taskId);
    const lastTask = lastMsgWithTask?.taskId ? tasksById.get(lastMsgWithTask.taskId) : undefined;
    if (lastTask) {
      setMission({
        active: false,
        taskId: lastTask.id,
        objectif: lastTask.objectif,
        criteres: "",
        steps: lastTask.steps ?? [],
        tools: lastTask.toolCalls ?? [],
        sources: lastTask.sources ?? [],
        statut: lastTask.statut,
      });
    } else {
      setMission(EMPTY_MISSION);
    }
    setClarification(null);
    clarificationRef.current = null;
    setErreur(null);
  };

  function newConversation() {
    setActiveConvId(null);
    convIdRef.current = null;
    setMessages([]);
    setMission(EMPTY_MISSION);
    setClarification(null);
    clarificationRef.current = null;
    setErreur(null);
    setInput("");
    inputRef.current?.focus();
  }

  function answerClarification(option: string) {
    const cl = clarificationRef.current;
    if (cl) {
      setMessages((m) => [...m, { id: `local-a-${Date.now()}-${m.length}`, role: "assistant", content: cl.question, sources: [], taskId: null, createdAt: new Date().toISOString(), statut: "EN_ATTENTE_UTILISATEUR" }]);
    }
    clarificationRef.current = null;
    setClarification(null);
    send(option);
  }

  // ——— Message vocal réel : MediaRecorder → /api/voice/transcribe → texte dans l'input ———
  async function transcribeFinished(stream: MediaStream) {
    stream.getTracks().forEach((tr) => tr.stop());
    setRecording(false);
    setTranscribing(true);
    try {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const form = new FormData();
      form.append("audio", blob, "message.webm");
      const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !data.text) {
        toast({ title: t("common.error"), description: data.error ?? t("common.errorNetwork"), variant: "destructive" });
      } else {
        // le texte transcrit s'affiche intégralement dans l'input avant envoi
        setInput((prev) => (prev ? `${prev} ${data.text}`.trim() : String(data.text)));
        inputRef.current?.focus();
      }
    } catch {
      toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
    } finally {
      setTranscribing(false);
    }
  }

  async function toggleRecording() {
    if (recorderRef.current) {
      recorderRef.current.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        recorderRef.current = null;
        void transcribeFinished(stream);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      toast({ title: t("common.error"), description: t("assistant.micError"), variant: "destructive" });
    }
  }

  const examples = [t("assistant.example1"), t("assistant.example2"), t("assistant.example3")];
  const threadEmpty = messages.length === 0 && !clarification && !erreur;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* ——— Colonne conversation (2/3) ——— */}
      <section className="lg:col-span-2 flex flex-col gap-3 min-w-0" aria-label={t("assistant.title")}>
        <div className="flex items-center justify-between">
          <SectionTitle>{t("assistant.conversations")}</SectionTitle>
          <Button variant="ghost" size="sm" className="h-8 text-[12px] text-muted-foreground" onClick={newConversation}>
            <Plus className="h-3.5 w-3.5" />
            {t("assistant.newConversation")}
          </Button>
        </div>
        <div className="registre max-h-28 overflow-y-auto scroll-fin border rounded-md bg-card" role="list" aria-label={t("assistant.conversations")}>
          {conversations.length === 0 && convErreur ? (
            <EtatErreur compact onRetry={() => void refreshConversations()} />
          ) : conversations.length === 0 ? (
            <p className="text-[12px] text-muted-foreground px-3 py-2.5">{t("assistant.noConversation")}</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                role="listitem"
                onClick={() => void loadConversation(c.id)}
                aria-current={activeConvId === c.id ? "true" : undefined}
                className={`registre-row w-full min-h-[44px] text-left px-3 py-2 flex items-baseline gap-3 ${activeConvId === c.id ? "bg-secondary" : ""}`}
              >
                <span className="text-[13px] font-medium truncate">{c.title}</span>
                <span className="text-[11.5px] text-muted-foreground truncate flex-1 min-w-0">{c.lastMessage}</span>
                <span className="text-[11px] tnum text-muted-foreground shrink-0">{new Date(c.createdAt).toLocaleDateString()}</span>
              </button>
            ))
          )}
        </div>

        {/* Fil de discussion */}
        <div ref={threadRef} className="flex-1 min-h-[340px] lg:min-h-0 lg:h-[calc(100vh-24rem)] overflow-y-auto scroll-fin border rounded-lg bg-card px-4 py-4 space-y-4">
          {threadEmpty ? (
            <div className="h-full flex flex-col justify-center gap-3 py-10">
              <p className="text-[14px] text-muted-foreground">{t("assistant.empty")}</p>
              <ul className="space-y-2">
                {examples.map((ex) => (
                  <li key={ex}>
                    <button
                      onClick={() => setInput(ex)}
                      className="text-[13.5px] text-muted-foreground text-left underline-offset-4 hover:underline hover:text-foreground"
                    >
                      {ex}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] bg-secondary rounded-md px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap">{m.content}</div>
                  </div>
                ) : (
                  <div key={m.id} className="max-w-[94%]">
                    {m.statut && <div className="mb-1.5">{statutPill(m.statut, t(`assistant.status.${m.statut}`))}</div>}
                    <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{m.content}</p>
                    {m.sources.length > 0 && <SourcesList sources={m.sources} onOpen={openSource} pageLabel={t("assistant.page")} />}
                  </div>
                )
              )}
              {clarification && (
                <div className="max-w-[94%] border-l-2 pl-3" style={{ borderColor: "var(--carton)" }}>
                  <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{clarification.question}</p>
                  {clarification.options.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      {clarification.options.map((o) => (
                        <Button key={o} variant="outline" size="sm" className="h-9 text-[12.5px]" onClick={() => answerClarification(o)}>
                          {o}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {erreur && (
                <div className="max-w-[94%] rounded-md px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ background: "var(--erreur-fond)", color: "var(--erreur)" }} role="alert">
                  {erreur}
                </div>
              )}
              {mission.active && (
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground" aria-live="polite">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {t("assistant.thinking")}
                </div>
              )}
            </>
          )}
        </div>

        {/* File d'attente visuelle pendant une mission */}
        {queue.length > 0 && (
          <div aria-live="polite">
            <ul className="space-y-1">
              {queue.map((q, i) => (
                <li key={`${i}-${q}`} className="flex items-center gap-2 text-[12px] text-muted-foreground min-h-[28px]">
                  <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{q}</span>
                  <span className="shrink-0 text-[11px]">{t("assistant.queued")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Saisie : un seul bouton primaire (assistant.send) */}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <Button
            type="button"
            variant="ghost"
            className="h-11 w-11 px-0 shrink-0"
            onClick={() => void toggleRecording()}
            disabled={transcribing}
            aria-label={recording ? t("assistant.stop") : t("assistant.record")}
            title={recording ? t("assistant.stop") : t("assistant.record")}
          >
            {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("assistant.placeholder")}
            className="h-11 flex-1 min-w-0"
            aria-label={t("assistant.placeholder")}
          />
          {transcribing ? (
            <span className="inline-flex items-center gap-2 text-[12px] text-muted-foreground px-2 h-11 min-w-[112px] justify-center">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {t("assistant.transcribing")}
            </span>
          ) : (
            <Button type="submit" className="h-11 px-5 shrink-0" disabled={!input.trim()}>
              {t("assistant.send")}
            </Button>
          )}
        </form>
      </section>

      {/* ——— Panneau mission (1/3) ——— */}
      <aside className="border rounded-lg bg-card p-4 flex flex-col gap-4 min-w-0 overflow-y-auto scroll-fin max-h-[80vh] lg:max-h-none" aria-label={t("assistant.workbench")}>
        {mission.taskId || mission.active ? (
          <>
            <div>
              <div className="flex items-center gap-2">
                <SectionTitle>{t("assistant.mission")}</SectionTitle>
                {mission.active && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden="true" />}
              </div>
              <p className="text-[13px] font-medium leading-snug mt-2 whitespace-pre-wrap">{mission.objectif}</p>
              {mission.criteres && (
                <p className="text-[11.5px] text-muted-foreground mt-1.5 leading-snug">
                  {t("assistant.criteres")} · {mission.criteres}
                </p>
              )}
            </div>

            <div>
              <SectionTitle>{t("assistant.plan")}</SectionTitle>
              {mission.steps.length === 0 ? (
                <p className="text-[12px] text-muted-foreground mt-1.5">{mission.active ? t("assistant.thinking") : "—"}</p>
              ) : (
                <ul className="mt-1.5">
                  {mission.steps.map((s) => (
                    <li key={`${s.no}-${s.label}`} className="flex items-start gap-2 py-1.5 border-b border-border last:border-0">
                      <span className="tnum text-[11px] text-muted-foreground w-4 shrink-0 mt-0.5 text-right">{s.no}</span>
                      <span className="mt-1 shrink-0" aria-hidden="true">
                        {s.statut === "EN_COURS" && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                        {s.statut === "FAIT" && <span className="block h-2 w-2 rounded-full" style={{ background: "var(--ruban)" }} />}
                        {s.statut === "ECHEC" && <CrossMark color="var(--erreur)" />}
                      </span>
                      <span className={`text-[12.5px] leading-snug ${s.statut === "EN_COURS" ? "text-muted-foreground" : ""}`}>{s.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {mission.tools.length > 0 && (
              <div>
                <SectionTitle>{t("assistant.tools")}</SectionTitle>
                <ul className="mt-1.5">
                  {mission.tools.map((tool, i) => (
                    <li key={`${tool.tool}-${i}`} className="py-2 border-b border-border last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-medium">{tool.tool}</span>
                        {tool.ok === true && <span className="h-2 w-2 rounded-full shrink-0" style={{ background: "var(--ruban)" }} aria-label="ok" />}
                        {tool.ok === false && <CrossMark color="var(--erreur)" />}
                        {typeof tool.ms === "number" && <span className="ml-auto text-[11px] tnum text-muted-foreground shrink-0">{tool.ms} ms</span>}
                      </div>
                      <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug break-words">{tool.resultSummary}</p>
                      {tool.proof && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug break-words">{t("assistant.proof")} · {tool.proof}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {mission.sources.length > 0 && (
              <div>
                <SectionTitle>{t("assistant.sources")}</SectionTitle>
                <SourcesList sources={mission.sources} onOpen={openSource} pageLabel={t("assistant.page")} />
              </div>
            )}

            <div className="mt-auto pt-3 border-t border-border">
              <SectionTitle>{t("assistant.status")}</SectionTitle>
              <div className="mt-2 min-h-[20px]">
                {mission.statut ? (
                  statutPill(mission.statut, t(`assistant.status.${mission.statut}`))
                ) : mission.active ? (
                  <span className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    {t("assistant.thinking")}
                  </span>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <div>
            <SectionTitle>{t("assistant.workbench")}</SectionTitle>
            <p className="text-[12.5px] text-muted-foreground mt-2 leading-relaxed">{t("assistant.workbenchEmpty")}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

/** Sources cliquables : label + page en tnum, ouverture dans la vue Fichiers. */
function SourcesList({ sources, onOpen, pageLabel }: { sources: SourceRef[]; onOpen: (fileId: string) => void; pageLabel: string }) {
  return (
    <ul className="mt-2 border-t border-border pt-1.5 space-y-0.5">
      {sources.map((s, i) => (
        <li key={`${s.fileId}-${i}`}>
          <button
            onClick={() => onOpen(s.fileId)}
            className="inline-flex items-center gap-2 max-w-full min-h-[32px] text-[12px] text-muted-foreground hover:text-foreground underline-offset-4 hover:underline text-left"
            title={s.ref ?? s.label}
          >
            <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{s.label}</span>
            {s.page != null && <span className="tnum shrink-0">{pageLabel}{s.page}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
