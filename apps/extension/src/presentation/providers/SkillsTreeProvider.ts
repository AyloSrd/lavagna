import * as vscode from 'vscode';
import { listSkillsWithState, SkillsDeps, SkillWithState, TargetStatus } from '../../application/usecases/skills';
import { isPresent } from '../../domain/skills/installState';
import { InstallState, SkillDescriptor } from '../../domain/skills/types';
import { log } from '../../infrastructure/logging/log';

/** Set while the bundled manifest can't be read; drives the view's welcome text. */
export const CATALOG_UNAVAILABLE_CONTEXT = 'lavagna.skillsCatalogUnavailable';

/**
 * Context keys survive nothing across windows, but a stale `true` would show
 * the "package may be incomplete" welcome over an empty view that was never
 * expanded. `_roots()` only runs once the user expands the section, so the key
 * is cleared at activation instead of being left to it.
 */
export function resetCatalogUnavailable(): Thenable<unknown> {
  return vscode.commands.executeCommand('setContext', CATALOG_UNAVAILABLE_CONTEXT, false);
}

export interface SkillNode {
  kind: 'skill';
  entry: SkillWithState;
}

export interface TargetNode {
  kind: 'target';
  skill: SkillDescriptor;
  status: TargetStatus;
}

export type SkillsNode = SkillNode | TargetNode;

/**
 * Skills the extension ships, each expanded into the agents it can be
 * installed for. Purely a display: every write goes through a command the
 * user clicks.
 */
export class SkillsTreeProvider implements vscode.TreeDataProvider<SkillsNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly _deps: SkillsDeps) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: SkillsNode): vscode.TreeItem {
    return node.kind === 'skill' ? skillItem(node) : targetItem(node);
  }

  async getChildren(node?: SkillsNode): Promise<SkillsNode[]> {
    if (!node) {
      return this._roots();
    }
    if (node.kind === 'skill') {
      return node.entry.targets.map((status) => ({ kind: 'target', skill: node.entry.skill, status }));
    }
    return [];
  }

  private async _roots(): Promise<SkillsNode[]> {
    try {
      const entries = await listSkillsWithState(this._deps);
      await vscode.commands.executeCommand('setContext', CATALOG_UNAVAILABLE_CONTEXT, false);
      return entries.map((entry) => ({ kind: 'skill', entry }));
    } catch (error) {
      log(`skills catalog unavailable: ${error instanceof Error ? error.message : String(error)}`);
      await vscode.commands.executeCommand('setContext', CATALOG_UNAVAILABLE_CONTEXT, true);
      return [];
    }
  }
}

function skillItem(node: SkillNode): vscode.TreeItem {
  const { skill } = node.entry;
  const item = new vscode.TreeItem(skill.title, vscode.TreeItemCollapsibleState.Expanded);
  item.id = `skill:${skill.id}`;
  item.description = `v${skill.version}`;
  item.tooltip = skill.summary;
  item.contextValue = 'lavagnaSkill';
  item.iconPath = new vscode.ThemeIcon('book');
  return item;
}

function targetItem(node: TargetNode): vscode.TreeItem {
  const { status, skill } = node;
  const item = new vscode.TreeItem(status.target.label, vscode.TreeItemCollapsibleState.None);
  item.id = `skill:${skill.id}:${status.target.id}`;
  item.description = describeStates(status);
  item.tooltip = new vscode.MarkdownString(
    [
      `**${status.target.label}** — ${skill.title}`,
      '',
      status.global === undefined
        ? '- Global: unavailable on this host'
        : `- Global (\`~/${status.target.globalDir}\`): ${stateWord(status.global)}`,
      status.project === undefined
        ? '- This workspace: open a local folder'
        : `- This workspace (\`${status.target.projectDir}\`): ${stateWord(status.project)}`,
    ].join('\n'),
  );
  item.iconPath = new vscode.ThemeIcon(stateIcon(status));
  item.contextValue = targetContextValue(status);
  return item;
}

/** `global ✓ · project –` — one glyph per available scope. */
export function describeStates(status: TargetStatus): string {
  const parts: string[] = [];
  if (status.global !== undefined) {
    parts.push(`global ${stateGlyph(status.global)}`);
  }
  if (status.project !== undefined) {
    parts.push(`project ${stateGlyph(status.project)}`);
  }
  return parts.join(' · ');
}

function stateGlyph(state: InstallState): string {
  switch (state) {
    case 'installed':
      return '✓';
    case 'update-available':
      return '↑';
    case 'unknown':
      return '?';
    case 'not-installed':
      return '–';
  }
}

function stateWord(state: InstallState): string {
  switch (state) {
    case 'installed':
      return 'installed';
    case 'update-available':
      return 'update available';
    case 'unknown':
      return 'installed, version unreadable';
    case 'not-installed':
      return 'not installed';
  }
}

function stateIcon(status: TargetStatus): string {
  const states = scopeStates(status);
  if (states.includes('update-available')) {
    return 'arrow-up';
  }
  if (states.some(isPresent)) {
    return 'check';
  }
  return 'circle-large-outline';
}

/**
 * `lavagnaSkillTarget`, suffixed with `.present` when something is installed
 * in either scope, `.update` when an update is available, and `.installable`
 * while some available scope is not already at the bundled version — the menu
 * `when` clauses match these with a regex. A row that is fully installed
 * everywhere carries neither `.update` nor `.installable`, so it shows only
 * Remove.
 */
export function targetContextValue(status: TargetStatus): string {
  const states = scopeStates(status);
  let value = 'lavagnaSkillTarget';
  if (states.some(isPresent)) {
    value += '.present';
  }
  if (states.includes('update-available')) {
    value += '.update';
  }
  // No scope at all (no home, no local folder) means nothing to install into.
  if (states.length > 0 && states.some((state) => state !== 'installed')) {
    value += '.installable';
  }
  return value;
}

/** The states of the scopes that exist on this host, in scope order. */
function scopeStates(status: TargetStatus): InstallState[] {
  return [status.global, status.project].filter((state): state is InstallState => state !== undefined);
}
