import * as vscode from 'vscode';

function nonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const token = nonce();
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'panel.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'panel.js'));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${token}';">
    <link rel="stylesheet" href="${styleUri}">
    <title>Agentic Toolbox</title>
  </head>
  <body>
    <main id="app" aria-live="polite">
      <div class="boot">
        <div class="boot-mark"><span></span><span></span><span></span></div>
        <p>Opening your toolbox…</p>
      </div>
    </main>
    <div id="toast-region" class="toast-region" aria-live="assertive"></div>
    <script nonce="${token}" src="${scriptUri}"></script>
  </body>
</html>`;
}
