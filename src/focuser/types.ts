export type FocusCommand =
  | { kind: 'terminal-app'; tty: string }
  | { kind: 'editor'; cli: 'code' | 'cursor'; gitRoot: string; bundleId: string }
  | { kind: 'reveal'; path: string }
  | { kind: 'copy-path'; path: string };

export interface ExecStep {
  program: string;
  args: string[];
  stdin?: string;
}

export interface FocusResult {
  ok: boolean;
  command: FocusCommand;
  usedFallback: boolean;
  message: string;
}

export type Runner = (step: ExecStep) => Promise<{ ok: boolean }>;
