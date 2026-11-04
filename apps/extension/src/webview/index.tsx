import React from 'react';
import { createRoot } from 'react-dom/client';
import flowCss from '@xyflow/react/dist/style.css';
import type { BlockInitMessage } from '../shared/messages';
import { BlockEditorApp } from './BlockEditorApp';
import { BlockLifecycleHandler, initHostBridge } from './hostBridge';
import { UI_CSS } from './ui/styles';

// React Flow ships its styles as a stylesheet; inject them once (bundled as
// text via esbuild's css loader, so no extra <link>/CSP changes).
const flowStyle = document.createElement('style');
flowStyle.textContent = flowCss;
document.head.appendChild(flowStyle);

// The editors' shared look (toolbars, floating bars, code pane).
const uiStyle = document.createElement('style');
uiStyle.textContent = UI_CSS;
document.head.appendChild(uiStyle);

// The bridge must listen before React renders (`ready` triggers the host's
// `block.init`), so route through a proxy that buffers until the app registers.
let delegate: BlockLifecycleHandler | null = null;
let bufferedInit: BlockInitMessage | null = null;

initHostBridge({
  onInit: (msg) => {
    if (delegate) { delegate.onInit(msg); } else { bufferedInit = msg; }
  },
  onUpdate: (content, imageUri, imageState) => delegate?.onUpdate(content, imageUri, imageState),
  onAck: (rev) => delegate?.onAck(rev),
  onWriteFailed: (rev, message) => delegate?.onWriteFailed(rev, message),
  onGone: () => delegate?.onGone(),
});

const root = createRoot(document.getElementById('root')!);
root.render(
  <BlockEditorApp
    registerHandler={(handler) => {
      delegate = handler;
      if (bufferedInit) {
        handler.onInit(bufferedInit);
        bufferedInit = null;
      }
    }}
  />,
);
