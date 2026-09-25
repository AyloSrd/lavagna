import React, { useRef, useState, useSyncExternalStore } from 'react';
import type { BlockInitMessage, CanvasImageState } from '../shared/messages';
import { BlockLifecycleHandler, copyToClipboard, postBlockChange } from './hostBridge';
import { BlockSync } from './sync';
import { ConflictBanner } from './components/ConflictBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CanvasEditor } from './editors/CanvasEditor';
import { FlowEditor } from './editors/FlowEditor';
import { SequenceEditor } from './editors/SequenceEditor';
import { mermaidKindOf } from './format/sequence';
import { TableEditor } from './editors/TableEditor';
import { TreeEditor } from './editors/TreeEditor';

export interface EditorProps {
  value: string;
  onChange(next: string): void;
  /** Commit immediately (drag end, blur) instead of waiting out the debounce. */
  onGestureEnd(): void;
}

interface Session {
  init: BlockInitMessage;
  sync: BlockSync;
}

/**
 * Root component. Receives `block.init` via the host bridge; each init starts a
 * fresh session (keyed remount), so retargeting the panel resets all editor state.
 */
export function BlockEditorApp({
  registerHandler,
}: {
  registerHandler: (handler: BlockLifecycleHandler) => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageState, setImageState] = useState<CanvasImageState | null>(null);
  const sessionRef = useRef<Session | null>(null);

  // The bridge is module-level and outlives React renders; register once.
  const registered = useRef(false);
  if (!registered.current) {
    registered.current = true;
    registerHandler({
      onInit: (init) => {
        sessionRef.current?.sync.dispose();
        const sync = new BlockSync(init.content, postBlockChange);
        sessionRef.current = { init, sync };
        setSession(sessionRef.current);
        setImageUri(init.imageUri);
        setImageState(init.imageState);
      },
      onUpdate: (content, uri, state) => {
        sessionRef.current?.sync.handleExternalUpdate(content);
        setImageUri(uri);
        setImageState(state);
      },
      onAck: (rev) => sessionRef.current?.sync.handleAck(rev),
      onWriteFailed: (_rev, message) => sessionRef.current?.sync.handleWriteFailed(message),
      onGone: () => sessionRef.current?.sync.handleGone(),
    });
  }

  if (!session) {
    return (
      <Centered>
        Open a block from a <code>.lavagna.md</code> file to edit it here.
      </Centered>
    );
  }
  return (
    <BlockSession
      key={session.init.token}
      session={session}
      imageUri={imageUri}
      imageState={imageState}
    />
  );
}

function BlockSession({
  session,
  imageUri,
  imageState,
}: {
  session: Session;
  imageUri: string | null;
  imageState: CanvasImageState | null;
}) {
  const { init, sync } = session;
  const snap = useSyncExternalStore(sync.subscribe, sync.snapshot);

  if (snap.status === 'gone') {
    return (
      <Centered>
        <p style={{ marginBottom: 12 }}>This block was removed from the file.</p>
        <button
          style={BUTTON}
          onClick={() => copyToClipboard(snap.content, 'Block content copied')}
        >
          Copy content
        </button>
      </Centered>
    );
  }

  const editorProps: EditorProps = {
    value: snap.content,
    onChange: (next) => sync.userEdited(next),
    onGestureEnd: () => sync.flush(),
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {snap.status === 'conflict' && (
        <ConflictBanner
          failure={snap.failure}
          hasFileVersion={snap.fileContent !== null}
          onLoadFile={() => sync.loadFileVersion()}
          onKeepMine={() => sync.keepMine()}
        />
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <ErrorBoundary>
          {init.kind === 'tree' ? (
            <TreeEditor {...editorProps} />
          ) : init.kind === 'mermaid' ? (
            // One fence language, several diagram types — dispatch on the
            // header so a sequence diagram gets its own editor rather than
            // being refused by the flowchart parser.
            mermaidKindOf(snap.content) === 'sequence' ? (
              <SequenceEditor {...editorProps} />
            ) : (
              <FlowEditor {...editorProps} />
            )
          ) : init.kind === 'table' ? (
            <TableEditor {...editorProps} />
          ) : (
            <CanvasEditor {...editorProps} imageUri={imageUri} imageState={imageState} />
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}

const BUTTON: React.CSSProperties = {
  background: 'var(--vscode-button-background, #0e639c)',
  color: 'var(--vscode-button-foreground, #fff)',
  border: 'none',
  borderRadius: 3,
  padding: '5px 12px',
  cursor: 'pointer',
};

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.85,
        padding: 24,
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  );
}
