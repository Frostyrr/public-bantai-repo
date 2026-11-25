import { showFormErrors } from "../../lib/formValidation";
import { useId, useLayoutEffect, useRef, type FormEventHandler, type ReactNode } from "react";
import { X } from "lucide-react";
import Modal from "./Modal";
import "./wizard.css";

function WizardProgress({ steps, step }: { steps: readonly string[]; step: number }) {
  return <ol aria-label="Wizard progress" className="mt-3 grid auto-cols-fr grid-flow-col gap-2">
    {steps.map((label, index) => <li key={label} aria-current={index + 1 === step ? "step" : undefined}>
      <span aria-hidden="true" className={`wizard-segment mb-1.5 block h-1 rounded-full ${index + 1 === step ? "bg-action" : index + 1 < step ? "bg-secondary" : "bg-elevated"}`} />
      <span className={`block text-xs ${index + 1 === step ? "font-semibold text-primary" : "text-secondary"}`}>{label}</span>
    </li>)}
  </ol>;
}

function WizardStep({ step, label, formId, onSubmit, children }: {
  step: number; label: string; formId: string; onSubmit: FormEventHandler<HTMLFormElement>; children: ReactNode;
}) {
  const viewport = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const previousStep = useRef(step);
  useLayoutEffect(() => {
    const panel = viewport.current;
    const body = content.current;
    if (!panel || !body) return;
    const previous = previousStep.current;
    previousStep.current = step;
    panel.scrollTop = 0;
    const focusFrame = requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
    if (step === previous || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => cancelAnimationFrame(focusFrame);
    const offset = step > previous ? 20 : -20;
    const duration = Number.parseFloat(getComputedStyle(body).getPropertyValue("--wizard-step-ms")) || 220;
    const animation = body.animate([
      { opacity: 0, transform: `translateX(${offset}px)` },
      { opacity: 1, transform: "translateX(0)" },
    ], { duration, easing: "ease-out" });
    return () => { cancelAnimationFrame(focusFrame); animation.cancel(); };
  }, [step]);

  return <form ref={viewport} id={formId} noValidate onSubmit={event => {
    if (showFormErrors(event.currentTarget)) {
      event.preventDefault();
      return;
    }
    onSubmit(event);
  }} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-4 sm:px-6">
    <div ref={content}>
      <h3 ref={heading} tabIndex={-1} className="mb-3 rounded text-base font-semibold text-primary focus-visible:outline-2 focus-visible:outline-border-strong">{label}</h3>
      {children}
    </div>
  </form>;
}

function WizardFooter({ children }: { children: ReactNode }) {
  return <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-subtle px-5 py-3 sm:px-6">{children}</footer>;
}

export default function WizardDialog({ isOpen, onClose, title, steps, step, stepTitle, formId, onSubmit, busy, footer, children }: {
  isOpen: boolean; onClose: () => void; title: string; steps: readonly string[]; step: number; stepTitle?: string;
  formId: string; onSubmit: FormEventHandler<HTMLFormElement>; busy?: boolean; footer: ReactNode; children: ReactNode;
}) {
  const titleId = useId();
  const close = () => { if (!busy) onClose(); };
  return <Modal isOpen={isOpen} onClose={close} labelledBy={titleId} maxWidth="max-w-[600px]"
    className="wizard-dialog flex max-h-[calc(100dvh-2rem)]! flex-col overflow-hidden! p-0! sm:max-h-[90dvh]!">
    <header className="shrink-0 border-b border-subtle px-5 py-3 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-xl font-semibold tracking-tight text-primary">{title}</h2>
        <button type="button" onClick={close} disabled={busy} aria-label={`Close ${title.toLowerCase()}`}
          className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl text-secondary hover:bg-elevated hover:text-primary focus-visible:outline-2 focus-visible:outline-border-strong disabled:opacity-50"><X size={18} /></button>
      </div>
      <WizardProgress steps={steps} step={step} />
    </header>
    <WizardStep step={step} label={stepTitle ?? steps[step - 1]} formId={formId} onSubmit={onSubmit}>{children}</WizardStep>
    <WizardFooter>{footer}</WizardFooter>
  </Modal>;
}
