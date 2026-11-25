import sharp from "sharp";

export const expectedReceipt = {
  merchant: "BANTAI TEST STORE", transactionDate: "2026-11-19", receiptNumber: "TEST-001",
  currency: "PHP", subtotal: "100.00", tax: "12.00", total: "112.00", paymentMethod: "Cash",
  lineItems: [{ description: "Notebook", quantity: "2", unitPrice: "50.00", total: "100.00" }],
};
export async function syntheticReceipt() {
  const lines = ["BANTAI TEST STORE", "SYNTHETIC TEST RECEIPT", "Date: 2026-11-19", "Receipt No: TEST-001", "Currency: PHP",
    "Notebook    2 x 50.00    100.00", "Subtotal: PHP 100.00", "Tax (12%): PHP 12.00", "TOTAL: PHP 112.00", "Payment method: Cash"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="950"><rect width="100%" height="100%" fill="white"/>
    ${lines.map((line, index) => `<text x="55" y="${80 + index * 78}" font-family="Arial" font-size="34" fill="black">${line}</text>`).join("")}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
