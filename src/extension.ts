import * as vscode from 'vscode';
import { ToolboxViewProvider } from './ToolboxViewProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const provider = new ToolboxViewProvider(context);
  context.subscriptions.push(provider);
  await provider.initializeDefaults();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ToolboxViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('agenticToolbox.refresh', () => provider.refreshSoon()),
    vscode.commands.registerCommand('agenticToolbox.open', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.agentic-toolbox');
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refreshSoon()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('agenticToolbox')) provider.refreshSoon();
    })
  );
}

export function deactivate(): void {
  // Disposables registered in the extension context are cleaned up by VS Code.
}
