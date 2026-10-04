import * as vscode from 'vscode';
import { BoardRepositoryPort } from './application/ports/BoardRepositoryPort';
import { MediaPort } from './application/ports/MediaPort';
import { VsCodeBoardRepository } from './infrastructure/boards/VsCodeBoardRepository';
import { NoopBoardRepository } from './infrastructure/boards/NoopBoardRepository';
import { VsCodeMediaRepository } from './infrastructure/media/VsCodeMediaRepository';
import { NoopMediaRepository } from './infrastructure/media/NoopMediaRepository';
import { BlockEditorPanel } from './presentation/BlockEditorPanel';
import { BoardsTreeProvider } from './presentation/providers/BoardsTreeProvider';
import { BlockCodeLensProvider } from './presentation/providers/BlockCodeLensProvider';
import { BlockHoverProvider } from './presentation/providers/BlockHoverProvider';
import { registerBoardCommands } from './presentation/commands/boardCommands';
import { registerBlockCommands } from './presentation/commands/blockCommands';
import { registerInsertFileRef } from './presentation/commands/insertFileRef';
import { FileRefLinkProvider, registerOpenFileRef } from './presentation/providers/FileRefLinkProvider';
import { CopySourceTracker } from './infrastructure/references/CopySourceTracker';
import { initLog, log } from './infrastructure/logging/log';
import { registerBoardPaste, registerBoardPasteText } from './presentation/commands/pasteBoard';
import { registerFileRefPaste } from './presentation/providers/FileRefPasteProvider';
import { SlashMenuProvider } from './presentation/providers/SlashMenuProvider';
import { LAVAGNA_DOC_SELECTOR } from './presentation/selectors';

// The agent-skills feature (Skills view, Install/Update/Remove commands, the
// first-board prompt) is built — domain/skills, usecases/skills,
// infrastructure/skills, the Skills tree and commands — but not shipped yet:
// nothing here wires it up, and package.json contributes none of its views,
// commands or settings. The build bundles /skills only when package.json
// contributes the `lavagna.skills` view (see esbuild.js), so turning the
// feature back on is: restore those contributions and the wiring the
// 0.2.0 release commit removed from this file (`git log -p -- src/extension.ts`).

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(initLog());
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  const boards: BoardRepositoryPort = workspaceRoot
    ? new VsCodeBoardRepository(workspaceRoot)
    : new NoopBoardRepository();
  const media: MediaPort = workspaceRoot
    ? new VsCodeMediaRepository(workspaceRoot)
    : new NoopMediaRepository();

  const tree = new BoardsTreeProvider(boards);
  // Remembers recent selections so a paste can name its source file even when
  // the host never ran the copy hook. Must be live before the user copies.
  const copySources = new CopySourceTracker();

  context.subscriptions.push(
    vscode.window.createTreeView('lavagna.boards', { treeDataProvider: tree }),
    vscode.languages.registerCodeLensProvider(LAVAGNA_DOC_SELECTOR, new BlockCodeLensProvider()),
    vscode.languages.registerHoverProvider(LAVAGNA_DOC_SELECTOR, new BlockHoverProvider()),
    vscode.languages.registerDocumentLinkProvider(LAVAGNA_DOC_SELECTOR, new FileRefLinkProvider()),
    // '/' opens the block menu, Notion-style.
    vscode.languages.registerCompletionItemProvider(LAVAGNA_DOC_SELECTOR, new SlashMenuProvider(), '/'),
    ...registerBoardCommands(boards, tree),
    ...registerBlockCommands((document, block) =>
      BlockEditorPanel.open(
        { extensionUri: context.extensionUri, media, workspaceRoot },
        document,
        block,
      ),
    ),
    registerInsertFileRef(),
    copySources.register(),
    registerBoardPaste(copySources),
    registerBoardPasteText(),
    registerOpenFileRef(),
  );

  // Feature-detected: absent on VS Code bases older than 1.97.
  const pasteRef = registerFileRefPaste(copySources);
  if (pasteRef) {
    context.subscriptions.push(pasteRef);
    log('paste provider registered');
  } else {
    log('paste provider NOT registered — host has no registerDocumentPasteEditProvider');
  }

  if (workspaceRoot) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, '.lavagna/*.lavagna.md'),
    );
    watcher.onDidCreate(() => tree.refresh());
    watcher.onDidChange(() => tree.refresh());
    watcher.onDidDelete(() => tree.refresh());
    context.subscriptions.push(watcher);
  }
}

export function deactivate() {}
