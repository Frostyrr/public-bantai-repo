export async function validateRosterXlsx(file: File): Promise<ArrayBuffer> {
  const input = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./validateRosterXlsx.worker.ts", import.meta.url), { type: "module" });
    const finish = () => { clearTimeout(timeout); worker.terminate(); };
    const timeout = window.setTimeout(() => {
      finish();
      reject(new Error("Workbook validation exceeded the 5 second limit."));
    }, 5000);
    worker.onmessage = (event: MessageEvent<{ data?: ArrayBuffer; error?: string }>) => {
      finish();
      if (event.data.data) resolve(event.data.data);
      else reject(new Error(event.data.error ?? "Workbook validation failed."));
    };
    worker.onerror = () => { finish(); reject(new Error("Workbook validation failed.")); };
    worker.postMessage(input, [input]);
  });
}
