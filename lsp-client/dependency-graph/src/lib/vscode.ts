import { writable, type Writable } from 'svelte/store';



export const lspData: Writable<any | null> = writable(null);

declare global {
  interface Window {
    acquireVsCodeApi: () => {
      postMessage: (message: any) => void;
      getState: () => any;
      setState: (state: any) => void;
    };
  }
}

export const vscode =
  typeof window !== 'undefined' && window.acquireVsCodeApi
    ? window.acquireVsCodeApi()
    : null;

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message.command !== 'string') return;
    switch (message.command) {
      case 'lsp-server/processedJson':
        if (!Array.isArray(message.files)) return;
        lspData.set({ files: message.files, connections: message.connections ?? [] });
        break;
    }
  });
}

export function sendMessage(command: string, data?: Record<string, unknown>) {
  if (vscode) {
    vscode.postMessage({ ...data, command });
  } else {
    console.warn('⚠️ VSCode API no disponible');
  }
}

/** Send a message and wait for a reply with the given response command. */
export function sendMessageAndWait(
  command: string,
  data: Record<string, unknown>,
  replyCommand: string,
  timeoutMs = 30000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('Timeout esperando respuesta de la extensión'));
    }, timeoutMs);

    function handler(event: MessageEvent) {
      const msg = event.data;
      if (!msg || msg.command !== replyCommand) return;
      clearTimeout(timer);
      window.removeEventListener('message', handler);
      resolve(msg);
    }

    window.addEventListener('message', handler);
    sendMessage(command, data);
  });
}
