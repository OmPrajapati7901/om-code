export function numberLines(text: string, startLine: number): string {
  if (text.length === 0) return "";
  const lines = text.endsWith("\n") ? text.split("\n").slice(0, -1) : text.split("\n");
  return lines.map((line, index) => `${String(startLine + index).padStart(6)}→${line}`).join("\n");
}

export function readHeader(
  path: string,
  range: { readonly startLine: number; readonly endLine: number } | undefined,
  totalLines: number | null,
): string {
  if (range === undefined && totalLines === 0) return `${path} (empty file)`;
  const start = range?.startLine ?? 1;
  const end = range?.endLine ?? totalLines ?? "unknown";
  return `${path} (lines ${start}-${end} of ${totalLines ?? "unknown"})`;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function grepHeader(pattern: string, root: string, matches: number, files: number): string {
  return `grep ${JSON.stringify(pattern)} in ${root} — ${countLabel(matches, "match", "matches")} in ${countLabel(files, "file")}`;
}

export function globHeader(pattern: string, root: string, files: number): string {
  return `glob ${JSON.stringify(pattern)} in ${root} — ${countLabel(files, "file")}`;
}
