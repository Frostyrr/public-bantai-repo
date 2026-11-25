export interface CompressImageOptions {
  maxDimension: number;
  maxLength: number;
  minWidth?: number;
  minHeight?: number;
}

export function compressImageFile(
  file: File,
  { maxDimension, maxLength, minWidth, minHeight }: CompressImageOptions,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      if ((minWidth && img.naturalWidth < minWidth) || (minHeight && img.naturalHeight < minHeight)) {
        reject(
          new Error(
            `Resolution too low (${img.naturalWidth} × ${img.naturalHeight}px). Minimum is ${minWidth ?? 1} × ${minHeight ?? 1}px.`,
          ),
        );
        return;
      }

      const canvas = document.createElement("canvas");
      const longest = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = longest > maxDimension ? maxDimension / longest : 1;
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to process image buffer."));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      let dataUrl = "";
      for (const quality of [0.85, 0.72, 0.58, 0.45]) {
        dataUrl = canvas.toDataURL("image/webp", quality);
        if (dataUrl.length <= maxLength) break;
      }
      if (dataUrl.length > maxLength) {
        dataUrl = canvas.toDataURL("image/jpeg", 0.5);
      }
      if (dataUrl.length > maxLength) {
        reject(new Error("Image is too large even after compression. Choose a smaller photo."));
        return;
      }

      resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The selected image is corrupted or cannot be decoded."));
    };

    img.src = objectUrl;
  });
}
