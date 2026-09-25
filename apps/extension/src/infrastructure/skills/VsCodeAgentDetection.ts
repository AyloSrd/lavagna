import * as vscode from 'vscode';
import { AgentDetectionPort } from '../../application/ports/AgentDetectionPort';
import { suggestTargets, WORKSPACE_MARKERS } from '../../domain/skills/agentTargets';
import { AgentTargetId } from '../../domain/skills/types';

/**
 * Gathers the raw signals — editor name, installed extensions, marker files in
 * the first workspace folder — and lets the domain decide what they suggest.
 */
export class VsCodeAgentDetection implements AgentDetectionPort {
  constructor(private readonly _workspaceRoot: vscode.Uri | undefined) {}

  async detect(): Promise<AgentTargetId[]> {
    return suggestTargets({
      appName: vscode.env.appName,
      extensionIds: vscode.extensions.all.map((extension) => extension.id),
      presentMarkers: await this._presentMarkers(),
    });
  }

  private async _presentMarkers(): Promise<string[]> {
    const root = this._workspaceRoot;
    if (!root) {
      return [];
    }
    const checks = WORKSPACE_MARKERS.map(async ({ path }) => {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, ...path.split('/')));
        return path;
      } catch {
        return undefined;
      }
    });
    return (await Promise.all(checks)).filter((path): path is string => path !== undefined);
  }
}
