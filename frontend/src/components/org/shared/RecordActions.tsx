import { useEffect, useRef, useState } from "react";
import { Archive, Eye, MoreHorizontal, Pencil, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import FloatingMenu from "../../../components/ui/FloatingMenu";
import CollectionArchiveAction from "../collections/CollectionArchiveAction";

type Props = {
  cardHeader?: boolean;
  title: string; onView?: () => void; onEdit?: () => void; onDelete?: () => void;
  extra?: { label: string; onClick: () => void };
  archive?: { org: string; id: string; kind: "collection" | "budget" | "expense"; archived: boolean; spaceName?: string };
};

export default function RecordActions(props: Props) {
  return props.archive ? <CollectionArchiveAction {...props.archive} title={props.title}
    renderTrigger={open => <ActionsMenu {...props} onArchive={open} />} /> : <ActionsMenu {...props} />;
}

function ActionsMenu({ title, onView, onEdit, onDelete, extra, archive, onArchive, cardHeader }: Props & { onArchive?: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(); }, [open]);
  const actions = [
    ...(onView ? [{ label: archive?.archived ? "View Details" : "View", icon: Eye, run: onView }] : []),
    ...(onEdit ? [{ label: "Edit", icon: Pencil, run: onEdit }] : []),
    ...(onArchive ? [{ label: archive?.archived ? "Restore" : "Archive", icon: archive?.archived ? RotateCcw : Archive, run: onArchive }] : []),
    ...(onDelete ? [{ label: "Delete", icon: Trash2, run: onDelete }] : []),
    ...(extra ? [{ label: extra.label, icon: ShieldCheck, run: extra.onClick }] : []),
  ];
  return <div ref={root} className="relative inline-flex shrink-0 items-center text-left">
    <button type="button" aria-label={`Actions for ${title}`} aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}
      className={`inline-flex size-10 cursor-pointer items-center justify-center rounded-xl text-secondary transition-colors hover:bg-elevated hover:text-primary focus-visible:outline-2 focus-visible:outline-border-strong ${cardHeader ? "translate-x-3" : ""}`}>
      {cardHeader ? <MoreHorizontal className="size-6" /> : <MoreHorizontal className="h-5 w-5" />}
    </button>
    <FloatingMenu open={open} align="right" role="menu" aria-label={`Actions for ${title}`} onClose={() => setOpen(false)}
      className="w-44 rounded-xl border border-subtle bg-surface p-1.5 shadow-xl"
      onKeyDown={event => {
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
        if (event.key === "Tab") setOpen(false);
      }}>
      {actions.map(({ label, icon: Icon, run }) => <button type="button" role="menuitem" key={label}
        onClick={() => { root.current?.querySelector('button')?.focus(); setOpen(false); run(); }}
        className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-sm text-primary hover:bg-elevated focus:bg-elevated focus:outline-none">
        <Icon className="h-4 w-4" />{label}
      </button>)}
    </FloatingMenu>
  </div>;
}
