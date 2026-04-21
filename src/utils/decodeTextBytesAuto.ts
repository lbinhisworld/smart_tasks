/**
 * @fileoverview 文本字节自动解码：优先合法 UTF-8（含去 BOM），否则尝试 GB18030/GBK（常见 Excel 简体中文 CSV）。
 *
 * @module decodeTextBytesAuto
 */

function stripUtf8BomBytes(u8: Uint8Array): Uint8Array {
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    return u8.subarray(3);
  }
  return u8;
}

function toArrayBufferSlice(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

/**
 * @param buf - 文件完整字节
 * @returns 解码后的字符串，供 CSV 等按行拆分
 */
export function decodeTextBytesAuto(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  const withoutBom = stripUtf8BomBytes(u8);
  const utf8Buf = toArrayBufferSlice(withoutBom);

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(utf8Buf);
  } catch {
    /* 非合法 UTF-8（多为本地 Excel 以 ANSI/GBK 保存的 CSV） */
  }

  for (const label of ["gb18030", "gbk"] as const) {
    try {
      const dec = new TextDecoder(label);
      const text = dec.decode(buf);
      if (text.length > 0) return text;
    } catch {
      /* 部分环境不支持该 label */
    }
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(utf8Buf);
}
