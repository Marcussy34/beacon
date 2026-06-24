// Cheap, offline "what is this session about" label: the user's prompt as a single line.
// No AI — a raw excerpt. We keep the WHOLE prompt (collapsed to one line); the panel decides
// how much to actually show by truncating to the window width via CSS, so a wider window shows
// more. MAX_CHARS is only a storage bound so we never persist an unbounded prompt.
// Pure + side-effect free → trivially testable and safe to call anywhere.
const MAX_CHARS = 300;

export function summarize(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim(); // collapse newlines/runs to single spaces
  if (oneLine.length <= MAX_CHARS) return oneLine;
  return `${oneLine.slice(0, MAX_CHARS - 1).trimEnd()}…`; // ellipsis only when we hit the bound
}
