import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut } from "lucide-react";

export default function ReceiptPreview({ file, name }: { file: Blob; name: string }) {
  const isImage = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  const [url, setUrl] = useState<string>("");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!isImage) return;
    const objectUrl = URL.createObjectURL(file);
    const id = requestAnimationFrame(() => setUrl(objectUrl));
    return () => {
      cancelAnimationFrame(id);
      URL.revokeObjectURL(objectUrl);
      setUrl("");
    };
  }, [file, isImage]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        event.preventDefault();
        setLightboxOpen(false);
        setZoomed(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [lightboxOpen]);

  if (!isImage || !url) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setZoomed(false);
          setLightboxOpen(true);
        }}
        title={`Inspect ${name}`}
        aria-label={`Zoom receipt preview for ${name}`}
        className="group relative flex h-full w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
      >
        <img src={url} alt={`Receipt preview for ${name}`} className="max-h-52 max-w-full rounded-lg object-contain transition-transform duration-150 group-hover:scale-105" />
      </button>

      {lightboxOpen && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Receipt preview: ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            setLightboxOpen(false);
            setZoomed(false);
          }}
          className="fixed inset-0 z-[100000] flex flex-col bg-black/40 backdrop-blur-lg backdrop-brightness-75 p-4 sm:p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="mx-auto mb-3 flex w-full max-w-4xl items-center justify-between gap-3 rounded-2xl border border-white/15 bg-zinc-900/75 px-4 py-2.5 text-white shadow-xl backdrop-blur-md"
          >
            <span className="min-w-0 truncate text-sm font-medium">{name}</span>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setZoomed((prev) => !prev)}
                aria-label={zoomed ? "Zoom out" : "Zoom in"}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/15 hover:text-white"
              >
                {zoomed ? <ZoomOut size={14} aria-hidden="true" /> : <ZoomIn size={14} aria-hidden="true" />}
                {zoomed ? "Fit" : "Zoom"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLightboxOpen(false);
                  setZoomed(false);
                }}
                aria-label="Close receipt preview"
                className="grid size-8 cursor-pointer place-items-center rounded-xl text-zinc-300 transition-colors hover:bg-white/15 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div
            onClick={(e) => e.stopPropagation()}
            className={`mx-auto flex min-h-0 w-full max-w-4xl flex-1 items-center justify-center rounded-2xl border border-white/15 bg-zinc-950/35 p-3 backdrop-blur-md ${
              zoomed ? "overflow-auto" : "overflow-hidden"
            }`}
          >
            <img
              src={url}
              alt={`Full receipt preview for ${name}`}
              onClick={() => setZoomed((prev) => !prev)}
              className={`rounded-lg transition-transform duration-200 select-none ${
                zoomed
                  ? "max-w-none scale-150 cursor-zoom-out sm:scale-175"
                  : "max-h-full max-w-full cursor-zoom-in object-contain"
              }`}
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
