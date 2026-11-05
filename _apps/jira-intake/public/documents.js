import { notesSource, validateSources } from "./planner.js";

export const FILE_LIMIT = 10 * 1024 * 1024;
const XML_LIMIT = 2 * 1024 * 1024;

export function checkFile(file) {
  if (!file || typeof file.name !== "string" || !file.size)
    throw new Error("The selected file is empty.");
  if (file.size > FILE_LIMIT)
    throw new Error("Each file must be 10 MB or smaller.");
  const extension = file.name.split(".").pop().toLowerCase();
  if (!["pdf", "docx", "txt", "md"].includes(extension))
    throw new Error("Use PDF, DOCX, TXT, or Markdown files.");
  return extension;
}

export async function readDocument(file, id) {
  const extension = checkFile(file);
  const name = file.name.split(/[\\/]/).pop().slice(0, 200);
  if (extension === "txt" || extension === "md") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.includes(0))
      throw new Error(
        "This does not look like a UTF-8 text file. Save it as UTF-8 text first.",
      );
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(
        "This text file is not UTF-8. Save it as UTF-8 and try again.",
      );
    }
    return {
      ...notesSource(text, name, id),
      kind: extension === "md" ? "Markdown" : "Text",
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (extension === "pdf") {
    if (
      !new TextDecoder("latin1")
        .decode(bytes.subarray(0, 1024))
        .includes("%PDF-")
    )
      throw new Error("The file is not a readable PDF.");
    const pdfjs = await import("./vendor/pdf.js");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "./vendor/pdf.worker.js",
      import.meta.url,
    ).href;
    let document;
    const task = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      enableXfa: false,
      useWasm: false,
      cMapUrl: new URL("./vendor/cmaps/", import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("./vendor/standard_fonts/", import.meta.url)
        .href,
    });
    try {
      document = await task.promise;
      if (document.numPages > 100)
        throw new Error(
          "PDFs are limited to 100 pages. Upload a smaller excerpt.",
        );
      const blocks = [];
      let length = 0;
      for (let page = 1; page <= document.numPages; page++) {
        const content = await (await document.getPage(page)).getTextContent();
        let line = "";
        const lines = [];
        for (const item of content.items) {
          if (typeof item.str !== "string") continue;
          line += `${line && !line.endsWith(" ") ? " " : ""}${item.str}`;
          if (item.hasEOL) {
            if (line.trim()) lines.push(line.trim());
            line = "";
          }
        }
        if (line.trim()) lines.push(line.trim());
        for (const text of lines) {
          length += text.length;
          if (length > 120000)
            throw new Error(
              "This PDF contains too much text. Upload a smaller excerpt.",
            );
          for (let offset = 0; offset < text.length; offset += 10000)
            blocks.push({
              id: `p${page}-b${blocks.length + 1}`,
              page,
              text: text.slice(offset, offset + 10000),
            });
        }
      }
      if (!blocks.length)
        throw new Error(
          "No readable text found. Scanned or image-only PDFs need OCR first; you can paste the OCR text instead.",
        );
      return validateSources([{ id, name, kind: "PDF", blocks }])[0];
    } catch (error) {
      if (error.name === "PasswordException")
        throw new Error(
          "Password-protected PDFs are not supported. Upload an unlocked copy.",
        );
      if (
        /worker|fetch|dynamically imported|module script/i.test(error.message)
      )
        throw new Error(
          "The PDF reader could not load. Check the app deployment includes its vendor files.",
        );
      throw new Error(
        error.message ||
          "Could not read this PDF. Try exporting a fresh text-based copy.",
      );
    } finally {
      await task.destroy();
    }
  }
  try {
    const { unzipSync } = await import("./vendor/fflate.js");
    let tooLarge = false;
    const entries = unzipSync(bytes, {
      filter: (entry) => {
        if (entry.name !== "word/document.xml") return false;
        if (entry.originalSize > XML_LIMIT) {
          tooLarge = true;
          return false;
        }
        return true;
      },
    });
    if (tooLarge)
      throw new Error(
        "The Word document is too large to read. Upload a smaller excerpt.",
      );
    const xmlBytes = entries["word/document.xml"];
    if (!xmlBytes || xmlBytes.length > XML_LIMIT)
      throw new Error("This is not a supported Word DOCX document.");
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(xmlBytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error(
        "This Word document contains unsupported XML declarations.",
      );
    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    if (parsed.querySelector("parsererror"))
      throw new Error("The Word document could not be read.");
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const paragraphs = [...parsed.getElementsByTagNameNS(ns, "p")]
      .map((p) =>
        [...p.getElementsByTagNameNS(ns, "t")]
          .map((t) => t.textContent)
          .join(""),
      )
      .filter((t) => t.trim());
    if (!paragraphs.length)
      throw new Error("No readable text was found in this Word document.");
    return { ...notesSource(paragraphs.join("\n"), name, id), kind: "Word" };
  } catch (error) {
    if (/too large|Word|XML|readable text/i.test(error.message)) throw error;
    throw new Error(
      "Could not read this DOCX file. Try saving a fresh Word document or exporting it as text.",
    );
  }
}
