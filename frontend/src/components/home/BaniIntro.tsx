import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, ArrowUp, Check, Pause, Play, Sparkles } from "lucide-react";
import Badge from "../ui/Badge";
import ScrollReveal from "../ui/ScrollReveal";
import Button from "../ui/Button";
import useAuth from "../../hooks/useAuth";
import bani from "../../assets/Bani 4.png";

const scenarios = [
  { label: "Collections", question: "How are our collections progressing?", answer: "PHP 18,000.00 collected out of a PHP 24,000.00 target. The drive is 75% complete, with PHP 6,000.00 remaining.", metric: "75%", detail: "of collection target received", progress: 75 },
  { label: "Budgets", question: "Which project budget is closest to its limit?", answer: "The General Assembly budget is closest to its limit. PHP 18,000.00 of PHP 20,000.00 has been spent, leaving PHP 2,000.00 available.", metric: "90%", detail: "of the project budget spent", progress: 90 },
  { label: "Expenses", question: "Are there any pending expense approvals?", answer: "Two expenses still need review: PHP 1,200.00 for event supplies and PHP 800.00 for printing.", metric: "2 expenses", detail: "pending officer review" },
  { label: "Cash Advances", question: "Who still has unliquidated cash advances?", answer: "Jamie Reyes has an outstanding PHP 5,000.00 advance for event logistics. The liquidation has yet to be submitted.", metric: "PHP 5,000.00", detail: "outstanding cash advance" },
].map(scenario => ({ ...scenario, words: scenario.answer.split(" ") }));

const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeToMotion(callback: () => void) {
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

type Frame = { phase: "prompt" | "send" | "lookup" | "answer" | "complete"; count: number; guide?: "next" | "input" | "text" | "send" };
const initialFrame: Frame = { phase: "prompt", count: 0 };
const control = "cursor-pointer rounded-full px-2.5 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2";

export default function BaniIntro() {
  const { user } = useAuth();
  const id = useId();
  const reducedMotion = useSyncExternalStore(subscribeToMotion, () => window.matchMedia(motionQuery).matches, () => true);
  const [selection, setSelection] = useState({ topic: 0, manual: false });
  const [frame, setFrame] = useState<Frame>(initialFrame);
  const elapsed = useRef(0);
  const [hovered, setHovered] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const insertionPoint = useRef<HTMLSpanElement>(null);
  const send = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<number>(undefined);
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [paused, setPaused] = useState(false);
  const scenario = scenarios[selection.topic];
  const phase = reducedMotion ? "complete" : frame.phase;
  const complete = phase === "complete";
  const nextTopic = (selection.topic + 1) % scenarios.length;
  const target = frame.guide === "next" ? nextTopic : phase === "prompt" && !frame.guide ? selection.topic : null;
  const aimAtSend = frame.guide === "send" || phase === "send";
  const aimAtInput = frame.guide === "input" || frame.guide === "text";
  const cursorShape = frame.guide === "text" ? "text"
    : phase === "send" || (phase === "prompt" && !frame.guide) ? "pointer" : "arrow";
  const typedCount = frame.phase === "prompt" && aimAtInput ? frame.count : 0;

  useLayoutEffect(() => {
    if (reducedMotion || !card.current) return;
    const surface = card.current;
    const element = aimAtSend ? send.current : aimAtInput ? insertionPoint.current : target === null ? null : tabs.current[target];
    const update = () => {
      const bounds = surface.getBoundingClientRect();
      const rect = element?.getBoundingClientRect();
      const next = rect
        ? { x: rect.left - bounds.left + rect.width / 2, y: rect.top - bounds.top + rect.height / 2 }
        : { x: bounds.width - 17, y: bounds.height - 19 };
      setPoint(previous => previous.x === next.x && previous.y === next.y ? previous : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(surface);
    tabs.current.forEach(tab => { if (tab) observer.observe(tab); });
    return () => observer.disconnect();
  }, [aimAtInput, aimAtSend, reducedMotion, target, typedCount]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const submitted = phase !== "prompt" && phase !== "send";

  useEffect(() => {
    if (reducedMotion || paused || (hovered && !selection.manual)) return;
    const typingStartsAt = selection.manual ? 0 : 940;
    const typedAt = typingStartsAt + scenario.question.length * 26;
    const submittedAt = typedAt + 520 + 120;
    const answerAt = submittedAt + 620;
    const completeAt = answerAt + Math.ceil(scenario.words.length / 2) * 115;
    let request: number;
    let previousTime: number | undefined;
    let lastFrame: Frame | undefined;

    function tick(now: number) {
      if (previousTime !== undefined) elapsed.current += Math.min(now - previousTime, 50);
      previousTime = now;
      const time = elapsed.current;
      if (hovered && time >= completeAt + 3500) return;
      if (time >= completeAt + 3500) {
        elapsed.current = 0;
        setFrame(initialFrame);
        setSelection({ topic: (selection.topic + 1) % scenarios.length, manual: false });
        return;
      }
      let next: Frame;
      if (time < typingStartsAt) next = { phase: "prompt", count: 0, guide: time < 420 ? undefined : "input" };
      else if (time < typedAt) next = { phase: "prompt", count: Math.floor((time - typingStartsAt) / 26), guide: "text" };
      else if (time < typedAt + 520) next = { phase: "prompt", count: scenario.question.length, guide: "send" };
      else if (time < submittedAt) next = { phase: "send", count: scenario.question.length };
      else if (time < answerAt) next = { phase: "lookup", count: 0 };
      else if (time < completeAt) next = { phase: "answer", count: 2 + 2 * Math.floor((time - answerAt) / 115) };
      else next = { phase: "complete", count: scenario.words.length, guide: time >= completeAt + 3000 ? "next" : undefined };

      if (next.phase !== lastFrame?.phase || next.count !== lastFrame.count || next.guide !== lastFrame.guide) {
        lastFrame = next;
        setFrame(next);
      }
      request = window.requestAnimationFrame(tick);
    }

    request = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(request);
  }, [hovered, paused, reducedMotion, scenario, selection]);

  return (
    <section id="bani" tabIndex={-1} aria-labelledby={id + "-heading"} className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
      <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
        <ScrollReveal className="min-w-0">
          <p className="mb-4 flex items-center gap-2 text-xs font-medium text-secondary">
            <Sparkles className="size-3.5" aria-hidden="true" /> AI Financial Assistant
          </p>
          <h2 id={id + "-heading"} className="text-3xl leading-[1.12] tracking-[-0.025em] sm:text-4xl md:text-[42px]">
            <span className="text-display-gradient">Meet Bani. Make sense of your financial records.</span>
          </h2>
          <p className="mt-5 max-w-lg text-sm leading-relaxed text-secondary sm:text-base">
            Ask about collections, budgets, expenses, and advances in plain language. Approvals and changes stay with your officers.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <Button to={user ? "/app" : "/register"} iconRight={<ArrowRight className="size-4" aria-hidden="true" />}>
              {user ? "Open your workspace" : "Get started with Bantai"}
            </Button>
            <Button to="/bani" variant="ghost" className="text-secondary hover:text-primary">
              How Bani works
            </Button>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={75} className="card-specular min-w-0 p-4 before:via-white/25 sm:p-6">
          <div ref={card} className="relative"
            onMouseEnter={() => { window.clearTimeout(hoverTimer.current); setHovered(true); }}
            onMouseLeave={() => { hoverTimer.current = window.setTimeout(() => setHovered(false), 1500); }}>
            {!reducedMotion && (
              <span aria-hidden="true"
                className={`pointer-events-none absolute left-0 top-0 z-30 transition-[transform,opacity] duration-[480ms,150ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${hovered || paused || selection.manual || !point.x ? "opacity-0" : submitted && !frame.guide ? "opacity-80" : "opacity-100"}`}
                style={{ transform: `translate3d(${point.x}px, ${point.y}px, 0)`, transitionDuration: cursorShape === "text" ? "45ms, 150ms" : undefined }}>
                <span className={`relative block size-4 origin-top-left ${phase === "send" ? "animate-[baniPointerTap_120ms_ease-out]" : cursorShape === "text" && frame.count < 5 ? "animate-[baniTextTap_120ms_ease-out]" : ""}`}>
                  {([
                    ["arrow", "M2 1 13 10 8.5 10.5 6.5 15 2 1Z", "-left-0.5 -top-px"],
                    ["text", "M4 1h8v2H9v10h3v2H4v-2h3V3H4Z", "-left-2 -top-2"],
                    ["pointer", "M6 8V2a1.3 1.3 0 0 1 2.6 0v4h3.9c1.5 0 2.3 1.2 2 2.5L13 15H6l-4-5a1.4 1.4 0 0 1 2-1.9l2 1.7Z", "-left-[7px] -top-px"],
                  ] as const).map(([shape, path, offset]) => (
                    <svg key={shape} viewBox="0 0 16 16" className={`absolute size-4 overflow-visible text-primary drop-shadow-sm transition-opacity duration-120 ${offset} ${shape === cursorShape ? "opacity-100" : "opacity-0"}`}>
                      <path d={path} fill="currentColor" stroke="var(--bg-surface)" strokeWidth="1.25" strokeLinejoin="round" />
                    </svg>
                  ))}
                </span>
              </span>
            )}
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle pb-4">
            <div className="flex items-center gap-2.5 font-medium text-primary">
              <span className="size-9 rounded-xl border border-subtle bg-elevated dark:bg-linear-to-b dark:from-zinc-900 dark:to-black p-1 shadow-xs dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
                <img src={bani} alt="" width={28} height={28} loading="lazy" className="size-full object-contain grayscale invert dark:invert-0" />
              </span>
              Ask Bani
            </div>
            <div className="flex items-center gap-2">
              <Badge>{reducedMotion ? "Preview" : "Live preview"}</Badge>
              {!reducedMotion && (
                <button type="button" onClick={() => setPaused(value => !value)} aria-label={paused ? "Resume demo" : "Pause demo"}
                  className="grid size-8 cursor-pointer place-items-center rounded-full border border-subtle text-secondary hover:bg-elevated hover:text-primary focus-visible:outline-2">
                  {paused ? <Play className="size-3.5" aria-hidden="true" /> : <Pause className="size-3.5" aria-hidden="true" />}
                </button>
              )}
            </div>
          </header>
          <div role="group" aria-label="Choose a demo topic" className="mt-3 flex flex-wrap gap-2">
            {scenarios.map(({ label }, index) => (
              <button key={label} ref={node => { tabs.current[index] = node; }} type="button" aria-pressed={selection.topic === index} aria-controls={id}
                onClick={() => { elapsed.current = 0; setPaused(false); setFrame(initialFrame); setSelection({ topic: index, manual: true }); }}
                className={control + (selection.topic === index ? " bg-selected-surface text-primary shadow-xs dark:shadow-none" : " text-muted hover:text-primary")}>
                {label}
              </button>
            ))}
          </div>


          <div id={id} className="min-h-[250px] space-y-3 py-4">
            <div className={"ml-auto flex min-h-11 w-fit max-w-[85%] items-center rounded-2xl border border-subtle bg-elevated px-4 py-2 text-sm text-primary " + (submitted ? "motion-safe:animate-[baniPromptEntrance_280ms_cubic-bezier(0.22,1,0.36,1)_both]" : "invisible")}>
              <span>{scenario.question}</span>
            </div>
            <div className={"flex min-h-7 w-fit items-center gap-1.5 rounded-full border border-subtle bg-surface px-2.5 py-1 text-[11px] text-secondary " + (submitted ? "motion-safe:animate-[baniAnswerEntrance_280ms_200ms_ease-out_both]" : "invisible")}>
              <Check className="size-3 shrink-0" aria-hidden="true" /> Queried Metro Chapter · AY 2026–2027 ledger
            </div>
            <div className="grid text-sm leading-relaxed tabular-nums text-primary/90">
              {scenarios.map(item => <p key={item.label} aria-hidden="true" className="invisible col-start-1 row-start-1">{item.answer}</p>)}
              <p className="col-start-1 row-start-1" aria-hidden={!complete}>
                {scenario.words.map((word, index) => (
                  <span key={index} className={"motion-safe:transition-opacity motion-safe:duration-150 " + (complete || (phase === "answer" && index < frame.count) ? "opacity-100" : "opacity-0")}>{word}{index < scenario.words.length - 1 ? " " : ""}</span>
                ))}
              </p>
            </div>
            <div className={"min-h-16 rounded-xl border border-subtle bg-elevated px-3 py-2 " + (complete ? "motion-safe:bani-answer-enter" : "invisible")}>
              <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-secondary"><strong className="text-base font-medium tabular-nums text-primary">{scenario.metric}</strong>{scenario.detail}</p>
              {scenario.progress !== undefined && <progress aria-label={scenario.detail} value={scenario.progress} max={100} className="mt-2 block h-1.5 w-full overflow-hidden rounded-full appearance-none bg-progress-track [&::-webkit-progress-bar]:bg-progress-track [&::-webkit-progress-value]:bg-action [&::-moz-progress-bar]:bg-action" />}
            </div>
          </div>

          <div aria-hidden="true" className="flex min-h-16 items-center justify-between gap-2 rounded-xl border border-subtle bg-elevated px-3.5 py-2.5 text-xs text-secondary">
            <div className="grid min-w-0">
              {scenarios.map(item => <span key={item.label} className="invisible col-start-1 row-start-1">{item.question}</span>)}
              <span className="col-start-1 row-start-1">{!submitted ? <>{scenario.question.slice(0, frame.count)}<span ref={insertionPoint} className="inline-block h-[1em] w-0 align-text-bottom" /></> : "Ask Bani about your workspace…"}</span>
            </div>
            <span ref={send} className={"relative grid size-7 shrink-0 place-items-center rounded-full bg-action text-action-fg motion-safe:transition-transform " + (phase === "send" ? "scale-110" : "")}>{phase === "send" && <span className="absolute inset-0 rounded-full border border-action/60 motion-safe:animate-ping" />}<ArrowUp className="size-4" /></span>
          </div>
          <p className="mt-3 text-xs text-secondary">Simulated conversation using fictional workspace records.</p>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
