export type FocusCommand =
  | { kind: 'terminal-app'; tty: string }
  | { kind: 'editor'; cli: 'code' | 'cursor'; gitRoot: string; bundleId: string; tty?: string }
  | { kind: 'reveal'; path: string }
  | { kind: 'copy-path'; path: string };

export interface ExecStep {
  program: string;
  args: string[];
  stdin?: string;
  // A failed `optional` step does not fail the run (best-effort, e.g. the editor focus URL).
  optional?: boolean;
  // Wait this many ms before running the step. Lets `open -b` finish raising the editor window
  // before the focus URL fires, so the URL routes to the right window (see exec-steps.ts).
  delayMs?: number;
}

export interface FocusResult {
  ok: boolean;
  command: FocusCommand;
  usedFallback: boolean;
  message: string;
}

export type Runner = (step: ExecStep) => Promise<{ ok: boolean }>;
