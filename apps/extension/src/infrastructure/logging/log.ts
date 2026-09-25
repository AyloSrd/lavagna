import * as vscode from 'vscode';

// A visible trace of the paste path.
//
// Every failure mode here looks identical from the outside — the text pastes
// normally and nothing reports why. There are six reasons the provider can
// decline and two more before it is even consulted, so guessing between them
// from the symptom is hopeless. This narrates each step into an output channel
// (View → Output → Lavagna).

let channel: vscode.OutputChannel | undefined;

export function initLog(): vscode.Disposable {
  channel = vscode.window.createOutputChannel('Lavagna');
  log('activated');
  return channel;
}

export function log(message: string): void {
  // Timestamps matter: they show whether the copy hook ran before the paste, or
  // never ran at all.
  channel?.appendLine(`${new Date().toISOString().slice(11, 23)}  ${message}`);
}
