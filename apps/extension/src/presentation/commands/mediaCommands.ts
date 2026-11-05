import * as vscode from 'vscode';
import { BoardRepositoryPort } from '../../application/ports/BoardRepositoryPort';
import { MediaPort } from '../../application/ports/MediaPort';
import { findUnusedMediaFiles, trashUnusedMedia } from '../../application/usecases/media';
import { log } from '../../infrastructure/logging/log';

/** How many file names the confirmation lists before summarising the rest. */
const LISTED = 10;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function registerMediaCommands(media: MediaPort, boards: BoardRepositoryPort): vscode.Disposable[] {
  return [
    // The brush only looks. Nothing is removed until the user has seen every
    // name in a list and then picked "Move to Trash" in a modal.
    vscode.commands.registerCommand('lavagna.cleanMedia', async () => {
      if (!media.isAvailable) {
        vscode.window.showErrorMessage('Lavagna: open a folder to clean its media.');
        return;
      }
      let unused: string[];
      try {
        unused = await vscode.window.withProgress(
          { location: { viewId: 'lavagna.boards' } },
          () => findUnusedMediaFiles(media, boards),
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        log(`cleanMedia: check failed — ${reason}`);
        vscode.window.showErrorMessage(`Lavagna: could not check .lavagna/media, so nothing was deleted. ${reason}`);
        return;
      }
      if (unused.length === 0) {
        vscode.window.showInformationMessage('Lavagna: no unused media — every image in .lavagna/media is used by a board.');
        return;
      }

      // Step one: every name, scrollable and ticked, so nothing goes unseen and
      // any image can be kept. Step two: a modal on what is still ticked.
      const picked = await vscode.window.showQuickPick(
        unused.map((name) => ({ label: name, description: '.lavagna/media', picked: true })),
        {
          canPickMany: true,
          title: `Unused media — ${plural(unused.length, 'image', 'images')} no board in .lavagna/ mentions`,
          placeHolder: 'Untick any image to keep, then press Enter',
          ignoreFocusOut: true,
        },
      );
      const chosen = picked?.map((item) => item.label) ?? [];
      if (chosen.length === 0) {
        return;
      }
      const listed = chosen.slice(0, LISTED).map((name) => `• ${name}`);
      if (chosen.length > LISTED) {
        listed.push(`…and ${chosen.length - LISTED} more you ticked in the list`);
      }
      const action = 'Move to Trash';
      const pick = await vscode.window.showWarningMessage(
        `Move ${plural(chosen.length, 'unused image', 'unused images')} to the trash?`,
        {
          modal: true,
          detail: [
            ...listed,
            '',
            'Images linked only from other files (a README, docs) count as unused. You can restore them from the trash.',
          ].join('\n'),
        },
        action,
      );
      if (pick !== action) {
        return;
      }

      let result;
      try {
        result = await trashUnusedMedia(media, boards, chosen);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        log(`cleanMedia: recheck failed — ${reason}`);
        vscode.window.showErrorMessage(`Lavagna: could not check .lavagna/media again, so nothing was deleted. ${reason}`);
        return;
      }
      for (const { name, reason } of result.failed) {
        log(`cleanMedia: ${name} — ${reason}`);
      }
      const kept = chosen.length - result.trashed.length - result.failed.length;
      const parts = [`moved ${plural(result.trashed.length, 'image', 'images')} to the trash`];
      if (kept > 0) {
        parts.push(`kept ${kept} that a board started using`);
      }
      if (result.failed.length > 0) {
        vscode.window.showWarningMessage(
          `Lavagna: ${parts.join(', ')}; ${result.failed.length} could not be removed — ${result.failed[0].reason}`,
        );
      } else {
        vscode.window.showInformationMessage(`Lavagna: ${parts.join(', ')}.`);
      }
    }),
  ];
}
