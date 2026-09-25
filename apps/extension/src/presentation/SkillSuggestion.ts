import * as vscode from 'vscode';
import { coreSkills, isInstalledForAny, SkillsDeps } from '../application/usecases/skills';
import { AGENT_TARGETS, agentTargetsFor } from '../domain/skills/agentTargets';
import { log } from '../infrastructure/logging/log';

const SETTING = 'skills.suggestOnFirstBoard';
const DISMISSED_KEY = 'lavagna.skills.suggestionDismissed';
/** Set the first time a board is created; the prompt is a first-board prompt. */
const FIRST_BOARD_KEY = 'lavagna.skills.firstBoardSeen';

/**
 * After the *first* board is created — the setting is called
 * `suggestOnFirstBoard`, and `lavagna.skills.firstBoardSeen` in global state
 * makes that true across sessions — offers to install the core skill. Never
 * twice after "Don't ask again". It only shows a prompt: the "Install…" button
 * runs the normal install flow, which asks scope and targets itself before
 * writing anything.
 */
export class SkillSuggestion {
  private _shownThisSession = false;

  constructor(
    private readonly _deps: SkillsDeps,
    private readonly _state: vscode.Memento,
  ) {}

  async offerAfterBoardCreated(): Promise<void> {
    if (this._shownThisSession) {
      return;
    }
    // A board has been created before, so this one isn't the first.
    if (this._state.get<boolean>(FIRST_BOARD_KEY, false)) {
      return;
    }
    await this._state.update(FIRST_BOARD_KEY, true);
    if (!vscode.workspace.getConfiguration('lavagna').get<boolean>(SETTING, true)) {
      return;
    }
    if (this._state.get<boolean>(DISMISSED_KEY, false)) {
      return;
    }
    let skill;
    try {
      [skill] = await coreSkills(this._deps);
    } catch (error) {
      log(`skill suggestion skipped, catalog unreadable: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!skill) {
      return;
    }
    const detected = agentTargetsFor(await this._deps.detection.detect());
    // Nothing detected: any existing install anywhere still means "don't nag".
    if (await isInstalledForAny(this._deps, skill, detected.length > 0 ? detected : AGENT_TARGETS)) {
      return;
    }
    this._shownThisSession = true;
    const labels = detected.map((t) => t.label).join(', ');
    const pick = await vscode.window.showInformationMessage(
      labels
        ? `Lavagna works best with its agent skill. Install it for ${labels}?`
        : 'Lavagna works best with its agent skill. Install it?',
      'Install…',
      'Not now',
      "Don't ask again",
    );
    if (pick === 'Install…') {
      await vscode.commands.executeCommand('lavagna.installSkill', skill.id);
    } else if (pick === "Don't ask again") {
      await this._state.update(DISMISSED_KEY, true);
    }
  }
}
