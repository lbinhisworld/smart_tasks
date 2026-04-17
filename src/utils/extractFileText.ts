/**
 * @fileoverview 上传文件 → 纯文本：按扩展名分支（Markdown / PDF / DOCX），供报告提取管线消费。
 *
 * **设计要点**
 * - PDF 使用 `pdfjs-dist` 逐页 `getTextContent` 拼接；扫描件无文字层时返回空并带 `note`。
 * - `.doc` 不支持，明确提示转 `.docx`。
 * - `pdf.worker` 通过 Vite `?url` 注入，避免打包路径问题。
 *
 * @module extractFileText
 */

import mammoth from "mammoth";
import * as pdfjs from "pdfjs-dist";
// Vite: bundle worker as separate URL
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/**
 * @param file - 浏览器 `File`，根据扩展名路由
 * @returns `text` 为抽取正文；`note` 仅在空结果或不支持类型时给出用户可读说明
 */
export async function extractTextFromFile(file: File): Promise<{ text: string; note?: string }> {
  const ext = extOf(file.name);

  if (ext === "md" || ext === "markdown") {
    const text = (await file.text()).replace(/^\uFEFF/, "").trim();
    return { text, note: text ? undefined : "Markdown 文件为空。" };
  }

  const buf = await file.arrayBuffer();

  if (ext === "pdf") {
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const parts: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const line = content.items
        .map((it) => ("str" in it ? it.str : ""))
        .filter(Boolean)
        .join(" ");
      parts.push(line);
    }
    const text = parts.join("\n\n").trim();
    return { text, note: text ? undefined : "PDF 未解析到文本（可能为扫描件，需 OCR）。" };
  }

  if (ext === "docx") {
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
    const text = (value || "").trim();
    return { text, note: text ? undefined : "Word 文档为空或无法读取正文。" };
  }

  if (ext === "doc") {
    return {
      text: "",
      note: "暂不支持旧版 .doc，请在 Word 中另存为 .docx 后重新上传。",
    };
  }

  return { text: "", note: `不支持的文件类型：.${ext || "?"}` };
}
