import * as vscode from 'vscode';
import { focusTerminalByTty, parseFocusTty } from './focus-terminal';
import { resolvePidTty } from './pid-tty';

// Activated on `onUri` (see package.json). Registers the handler for beacon.beacon-focus URIs.
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri): void {
        // Fire and forget: handleUri must return synchronously; focusing happens in the background.
        void handleFocusUri(uri);
      },
    }),
  );
}

async function handleFocusUri(uri: vscode.Uri): Promise<void> {
  const target = parseFocusTty(uri.path, uri.query);
  if (target === null) return; // not our /focus URL, or no tty -> no-op
  await focusTerminalByTty(target, vscode.window.terminals, resolvePidTty);
}

export function deactivate(): void {
  /* no resources to release beyond context.subscriptions */
}
