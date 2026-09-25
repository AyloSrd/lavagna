import { AgentTarget, AgentTargetId } from './types';

/**
 * The agents Lavagna knows how to install skills for. Several share
 * `.agents/skills` at project scope — the install plan deduplicates those so
 * a skill is written once per directory.
 */
export const AGENT_TARGETS: readonly AgentTarget[] = [
  { id: 'claude-code', label: 'Claude Code', projectDir: '.claude/skills', globalDir: '.claude/skills' },
  { id: 'cursor', label: 'Cursor', projectDir: '.agents/skills', globalDir: '.cursor/skills' },
  { id: 'codex', label: 'Codex', projectDir: '.agents/skills', globalDir: '.codex/skills' },
  { id: 'copilot', label: 'GitHub Copilot', projectDir: '.agents/skills', globalDir: '.copilot/skills' },
  { id: 'gemini', label: 'Gemini CLI', projectDir: '.agents/skills', globalDir: '.gemini/skills' },
  { id: 'agents', label: 'Other agents (.agents)', projectDir: '.agents/skills', globalDir: '.agents/skills' },
];

export function agentTarget(id: AgentTargetId): AgentTarget {
  const target = AGENT_TARGETS.find((t) => t.id === id);
  if (!target) {
    throw new Error(`Unknown agent target: ${id}`);
  }
  return target;
}

/** Keeps the table's order, drops unknown ids and duplicates. */
export function agentTargetsFor(ids: readonly string[]): AgentTarget[] {
  return AGENT_TARGETS.filter((t) => ids.includes(t.id));
}

// --- Detection -------------------------------------------------------------
//
// Which agents the user probably has. Only a hint for pre-selecting targets
// in the install picker — the user always confirms.

/** Files or folders in the workspace root that reveal an agent is in use. */
export const WORKSPACE_MARKERS: ReadonlyArray<{ path: string; target: AgentTargetId }> = [
  { path: 'CLAUDE.md', target: 'claude-code' },
  { path: '.claude', target: 'claude-code' },
  { path: '.cursor', target: 'cursor' },
  { path: '.codex', target: 'codex' },
  { path: '.github/copilot-instructions.md', target: 'copilot' },
  { path: '.gemini', target: 'gemini' },
  { path: 'AGENTS.md', target: 'agents' },
  { path: '.agents', target: 'agents' },
];

/** Installed editor extensions (lower-case ids) that reveal an agent. */
export const EXTENSION_MARKERS: Readonly<Record<string, AgentTargetId>> = {
  'anthropic.claude-code': 'claude-code',
  'openai.chatgpt': 'codex',
  'github.copilot-chat': 'copilot',
  'google.geminicodeassist': 'gemini',
};

/** Editors that are themselves an agent, matched on `env.appName`. */
export const APP_NAME_MARKERS: ReadonlyArray<{ contains: string; target: AgentTargetId }> = [
  { contains: 'cursor', target: 'cursor' },
  { contains: 'windsurf', target: 'agents' },
];

export interface DetectionSignals {
  /** The editor's product name, e.g. "Visual Studio Code" or "Cursor". */
  appName: string;
  /** Ids of installed extensions, any case. */
  extensionIds: readonly string[];
  /** Entries of WORKSPACE_MARKERS whose path exists in the workspace root. */
  presentMarkers: readonly string[];
}

/** Union of the three signal kinds, in AGENT_TARGETS order. */
export function suggestTargets(signals: DetectionSignals): AgentTargetId[] {
  const found = new Set<AgentTargetId>();
  const app = signals.appName.toLowerCase();
  for (const marker of APP_NAME_MARKERS) {
    if (app.includes(marker.contains)) {
      found.add(marker.target);
    }
  }
  for (const id of signals.extensionIds) {
    const target = EXTENSION_MARKERS[id.toLowerCase()];
    if (target) {
      found.add(target);
    }
  }
  for (const marker of WORKSPACE_MARKERS) {
    if (signals.presentMarkers.includes(marker.path)) {
      found.add(marker.target);
    }
  }
  return AGENT_TARGETS.map((t) => t.id).filter((id) => found.has(id));
}
