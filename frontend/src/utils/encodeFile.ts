export const encodeReceipt = (file: File) =>
  new Promise<{ name: string; mime: string; data: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read a receipt file."));
    reader.onload = () =>
      resolve({
        name: file.name,
        mime: file.type,
        data: String(reader.result).split(",")[1],
      });
    reader.readAsDataURL(file);
  });
