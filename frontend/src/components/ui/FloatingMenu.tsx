import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type RefObject } from 'react';

interface FloatingMenuProps extends HTMLAttributes<HTMLDivElement> {
  anchorRef?: RefObject<HTMLElement | null>;
  open?: boolean;
  onClose: () => void;
  align?: 'left' | 'right';
  matchWidth?: boolean;
  mobileSpacing?: boolean;
}

const EXIT_DURATION_MS = 140;

/** Top-layer menu: escapes ancestor clipping without moving outside its form/modal. */
export default function FloatingMenu({ anchorRef, open = true, onClose, align = 'left', matchWidth = false, mobileSpacing = false, className = '', style, ...props }: FloatingMenuProps) {
  const [keptMounted, setKeptMounted] = useState(open);
  const rendered = open || keptMounted;
  const closing = !open && keptMounted;

  useEffect(() => {
    if (open) {
      const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const id = requestAnimationFrame(() => setKeptMounted(!reduced));
      return () => cancelAnimationFrame(id);
    }
    if (!keptMounted) return;
    const timer = window.setTimeout(() => {
      setKeptMounted(false);
    }, EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [open, keptMounted]);

  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    if (!rendered) return;
    const menu = menuRef.current;
    const trigger = anchorRef?.current ?? menu?.parentElement?.querySelector('button');
    if (!menu || !trigger) return;
    // Measure in the top layer, but reveal only after assigning final coordinates.
    menu.style.visibility = 'hidden';
    menu.showPopover();

    const position = () => {
      const rect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const useMobileSpacing = mobileSpacing && window.matchMedia('(width < 48rem)').matches;
      const edge = useMobileSpacing ? 12 : 8;
      const gap = useMobileSpacing ? 10 : 6;
      menu.style.maxWidth = `${Math.max(0, width - edge * 2)}px`;
      if (matchWidth) menu.style.width = `${rect.width}px`;
      const scrollTop = menu.scrollTop;
      menu.style.removeProperty('max-height');
      if (style?.maxHeight !== undefined) {
        menu.style.maxHeight = typeof style.maxHeight === 'number' ? `${style.maxHeight}px` : style.maxHeight;
      }
      const desiredHeight = menu.offsetHeight;
      const below = Math.max(0, top + height - rect.bottom - gap - edge);
      const above = Math.max(0, rect.top - top - gap - edge);
      const flip = desiredHeight > below && above > below;
      const available = flip ? above : below;
      menu.style.maxHeight = `${Math.min(desiredHeight, available)}px`;
      if (menu.scrollTop !== scrollTop) menu.scrollTop = scrollTop;
      const x = align === 'right' ? rect.right - menu.offsetWidth : rect.left;
      menu.dataset.placement = flip ? 'top' : 'bottom';
      menu.dataset.align = align;
      menu.style.left = `${Math.max(left + edge, Math.min(x, left + width - menu.offsetWidth - edge))}px`;
      menu.style.top = `${flip ? Math.max(top + edge, rect.top - gap - menu.offsetHeight) : Math.max(top + edge, rect.bottom + gap)}px`;
    };
    const onScroll = (event: Event) => {
      if (event.target !== menu) position();
    };
    position();
    menu.style.visibility = 'visible';
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.contains(target) && !trigger.contains(target)) closeRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeRef.current();
      (trigger.querySelector<HTMLElement>('[role="combobox"]') ?? trigger).focus();
    };
    const observer = new ResizeObserver(position);
    observer.observe(trigger);
    observer.observe(menu);
    window.addEventListener('resize', position);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey, true);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
      if (menu.matches(':popover-open')) menu.hidePopover();
    };
  }, [rendered, anchorRef, align, matchWidth, mobileSpacing, style?.maxHeight]);

  if (!rendered) return null;

  return (
    <div
      {...props}
      ref={menuRef}
      popover="manual"
      data-state={closing ? 'closing' : 'open'}
      className={`floating-menu-panel ${className}`.trim()}
      style={{ ...style, position: 'fixed', inset: 'auto', margin: 0, overflowY: 'auto', zIndex: 2147483647 }}
    />
  );
}
