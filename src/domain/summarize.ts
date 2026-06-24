// Cheap, offline "what is this session about" label: first words of the user's prompt.
// No AI — a raw excerpt, deliberately tiny. Pure + side-effect free so it's trivially tested
// and safe to call from the hook process.
const MAX_WORDS = 5;
const MAX_CHARS = 48;

export function summarize(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim(); // collapse newlines/runs to single spaces
  if (!oneLine) return '';
  const words = oneLine.split(' ');
  let out = words.slice(0, MAX_WORDS).join(' ');
  let trimmed = words.length > MAX_WORDS;
  // Guard against a single giant "word" blowing past the cap.
  if (out.length > MAX_CHARS) { out = out.slice(0, MAX_CHARS - 1).trimEnd(); trimmed = true; }
  return trimmed ? `${out}…` : out;
}
