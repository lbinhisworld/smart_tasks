/**
 * @fileoverview 只读文本容器（如 `pre`）内，将浏览器 Selection 映射为纯文本下标区间。
 *
 * @module plainTextSelectionInElement
 */

/**
 * 返回当前选区在 `root` 内 `textContent` 顺序下的 [start, end)；折叠选区、选区跨出容器或异常时返回 null。
 * @param root 通常为日报详情的 `pre` 根节点
 */
export function getPlainTextRangeWithinElement(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  try {
    const beforeStart = document.createRange();
    beforeStart.selectNodeContents(root);
    beforeStart.setEnd(range.startContainer, range.startOffset);
    const start = beforeStart.toString().length;
    const beforeEnd = document.createRange();
    beforeEnd.selectNodeContents(root);
    beforeEnd.setEnd(range.endContainer, range.endOffset);
    const end = beforeEnd.toString().length;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return start <= end ? { start, end } : { start: end, end: start };
  } catch {
    return null;
  }
}
