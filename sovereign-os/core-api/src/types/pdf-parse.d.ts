declare module 'pdf-parse' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown>;
    text: string;
    version: string;
  }
  interface PdfParseOptions {
    pagerender?: (pageData: unknown) => Promise<string>;
    max?: number;
    /** รหัสเปิด PDF ที่เข้ารหัส (ถ้าสเตตเมนต์ล็อก) */
    password?: string;
  }
  function pdfParse(
    dataBuffer: Buffer,
    options?: PdfParseOptions
  ): Promise<PdfParseResult>;
  export default pdfParse;
}
