import { useEffect, useRef, useState } from 'react';

export default function OverviewCrop({ src, ratio, showMobilePreview, onApply }: { src: string; ratio: number; showMobilePreview?: boolean; onApply: (url: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mobile = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      const target = canvas.current;
      const context = target?.getContext('2d');
      if (!target || !context) return;
      const width = Math.min(image.naturalWidth, image.naturalHeight * ratio) / zoom;
      const height = width / ratio;
      context.clearRect(0, 0, target.width, target.height);
      context.drawImage(image, (image.naturalWidth - width) * position.x / 100,
        (image.naturalHeight - height) * position.y / 100, width, height, 0, 0, target.width, target.height);
      const mobileCanvas = mobile.current;
      const mobileContext = mobileCanvas?.getContext('2d');
      if (mobileCanvas && mobileContext) {
        const scale = Math.max(mobileCanvas.width / target.width, mobileCanvas.height / target.height);
        const scaledWidth = target.width * scale;
        const scaledHeight = target.height * scale;
        mobileContext.clearRect(0, 0, mobileCanvas.width, mobileCanvas.height);
        mobileContext.drawImage(target, (mobileCanvas.width - scaledWidth) / 2,
          (mobileCanvas.height - scaledHeight) / 2, scaledWidth, scaledHeight);
      }
      setReady(true);
    };
    image.src = src;
    return () => { image.onload = null; };
  }, [src, ratio, zoom, position]);
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  return <div className="space-y-3">
    {showMobilePreview && <p className="text-xs text-zinc-400">Current banner crop</p>}
    <canvas ref={canvas} width={ratio === 1 ? 512 : 1280} height={ratio === 1 ? 512 : Math.round(1280 / ratio)}
      aria-label="Crop preview" className="w-full max-h-72 object-contain touch-none cursor-grab rounded-xl bg-secondary-surface"
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y };
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (!start) return;
        setPosition({ x: clamp(start.left - (event.clientX - start.x) / 2), y: clamp(start.top - (event.clientY - start.y) / 2) });
      }}
      onLostPointerCapture={() => { drag.current = null; }} />
    {showMobilePreview && <div className="space-y-2">
      <p className="text-xs text-zinc-400">Mobile preview · 375 × 150</p>
      <canvas ref={mobile} width={375} height={150} aria-label="Mobile banner crop preview" className="w-full max-w-[375px] rounded-xl bg-secondary-surface" />
      <p className="text-xs text-zinc-400">Keep important text and logos visible in both previews.</p>
    </div>}
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="text-sm">Zoom<input className="block w-full" type="range" min={1} max={3} step={0.05} value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
      <label className="text-sm">Horizontal position<input className="block w-full" type="range" value={position.x} onChange={e => setPosition({ ...position, x: Number(e.target.value) })} /></label>
      <label className="text-sm">Vertical position<input className="block w-full" type="range" value={position.y} onChange={e => setPosition({ ...position, y: Number(e.target.value) })} /></label>
    </div>
    <button type="button" disabled={!ready} className="rounded-lg border border-strong px-3 py-2 text-sm hover:bg-secondary-surface focus-visible:ring-2 focus-visible:ring-zinc-400" onClick={() => { if (canvas.current) onApply(canvas.current.toDataURL('image/webp', 0.82)); }}>Apply crop to preview</button>
  </div>;
}
