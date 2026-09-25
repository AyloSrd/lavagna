import type { WebviewToHost } from '../shared/messages';

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;

/** The webview may only call acquireVsCodeApi once — cache it. */
function getVsCodeApi(): VsCodeApi {
  if (!api) { api = acquireVsCodeApi(); }
  return api;
}

export function postToHost(msg: WebviewToHost): void {
  getVsCodeApi().postMessage(msg);
}

interface PersistedState {
  content?: unknown;
}

/** Content persisted via the webview state API — survives the webview being destroyed and recreated. */
export function getPersistedContent(): unknown {
  const state = getVsCodeApi().getState() as PersistedState | undefined;
  return state?.content;
}

export function persistContent(content: unknown): void {
  getVsCodeApi().setState({ content });
}
