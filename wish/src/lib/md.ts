// Same minimal markdown-lite as now.arshnah.in's focus editor: escape first,
// then allow only **bold**, *italic*, and [text](url) — enough for "free
// text / markdown-ish" celebration copy without opening up to raw HTML.
export function mdToHtml(src: string): string {
  const esc = src.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  return esc
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
