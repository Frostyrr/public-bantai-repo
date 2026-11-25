import { validateRosterArchive } from "./validateRosterArchive";
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const validated = validateRosterArchive(event.data);
    self.postMessage({ data: validated.buffer }, { transfer: [validated.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Could not validate this workbook." });
  }
};
