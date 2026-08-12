import path from 'node:path';
import * as vscode from 'vscode';
import { isDirectory } from './fileSystem';
import type { ActivityItem, ProfileView, SkillView } from './model';
import { ToolboxService } from './toolbox';
import { DebouncedFolderWatcher } from './watcher';
import { getWebviewHtml } from './webviewHtml';

const CONFIG_SECTION = 'agenticToolbox';

interface WorkspaceView {
  id: string;
  name: string;
  path: string;
}

interface PanelState {
  workspaces: WorkspaceView[];
  selectedWorkspaceId?: string;
  workspaceReady: boolean;
  skillsLibrary: { path: string; valid: boolean };
  agentsLibrary: { path: string; valid: boolean };
  autoSync: boolean;
  skills: SkillView[];
  profiles: ProfileView[];
  activities: ActivityItem[];
  lastRefresh: string;
}

type IncomingMessage =
  | { type: 'ready' | 'refresh' | 'chooseSkillsLibrary' | 'chooseAgentsLibrary' | 'openAgentsFile' | 'revealAgentsFolder' | 'removeProfile' }
  | { type: 'selectWorkspace'; id: string }
  | { type: 'installSkill' | 'uninstallSkill' | 'applyProfile' | 'openSource'; id: string }
  | { type: 'setAutoSync'; enabled: boolean };

export class ToolboxViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'agenticToolbox.panel';

  private view?: vscode.WebviewView;
  private selectedWorkspaceId?: string;
  private state?: PanelState;
  private refreshTimer?: NodeJS.Timeout;
  private operation = Promise.resolve();
  private workspaceWatchers: vscode.Disposable[] = [];
  private readonly activities: ActivityItem[] = [];
  private readonly skillsWatcher = new DebouncedFolderWatcher(() => this.queueSourceRefresh());
  private readonly agentsWatcher = new DebouncedFolderWatcher(() => this.queueSourceRefresh());

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.selectedWorkspaceId = context.workspaceState.get<string>('selectedWorkspaceId');
  }

  public async initializeDefaults(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || folder.uri.scheme !== 'file') return;
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    if (!config.get<string>('skillsLibrary')) {
      const suggested = await this.firstDirectory([
        path.join(folder.uri.fsPath, '..', 'skills'),
        path.join(folder.uri.fsPath, '..', 'skill-library'),
        path.join(folder.uri.fsPath, '..', '..', 'skills_development', 'my-skills')
      ]);
      if (suggested) await config.update('skillsLibrary', suggested, vscode.ConfigurationTarget.Global);
    }
    if (!config.get<string>('agentsLibrary')) {
      const suggested = await this.firstDirectory([
        path.join(folder.uri.fsPath, '..', 'agents-family'),
        path.join(folder.uri.fsPath, '..', 'agent-profiles'),
        path.join(folder.uri.fsPath, '..', 'agents')
      ]);
      if (suggested) await config.update('agentsLibrary', suggested, vscode.ConfigurationTarget.Global);
    }
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };
    view.webview.html = getWebviewHtml(view.webview, this.context.extensionUri);
    view.webview.onDidReceiveMessage((message: IncomingMessage) => this.handleMessage(message), undefined, this.context.subscriptions);
    view.onDidDispose(() => { this.view = undefined; });
    void this.refresh();
  }

  public refreshSoon(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, 180);
  }

  private queueSourceRefresh(): void {
    this.enqueue(async () => {
      const service = this.service();
      if (service && this.configuration().get<boolean>('autoSync', true)) {
        const result = await service.syncManaged(this.skillsLibraryPath(), this.agentsLibraryPath());
        if (result.skills.length || result.profile) {
          const parts = [
            result.skills.length ? `${result.skills.length} skill${result.skills.length === 1 ? '' : 's'}` : '',
            result.profile ? `${result.profile} profile` : ''
          ].filter(Boolean);
          this.addActivity('sync', `Live-synced ${parts.join(' and ')}.`);
        }
      }
      await this.refresh();
    });
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
      case 'refresh':
        this.refreshSoon();
        return;
      case 'chooseSkillsLibrary':
        await this.chooseLibrary('skillsLibrary', 'Select your skills library');
        return;
      case 'chooseAgentsLibrary':
        await this.chooseLibrary('agentsLibrary', 'Select your AGENTS.md profile library');
        return;
      case 'selectWorkspace':
        this.selectedWorkspaceId = message.id;
        await this.context.workspaceState.update('selectedWorkspaceId', message.id);
        this.resetWorkspaceWatchers();
        await this.refresh();
        return;
      case 'setAutoSync':
        await this.configuration().update('autoSync', message.enabled, vscode.ConfigurationTarget.Global);
        this.notice(message.enabled ? 'Live sync is on.' : 'Live sync is paused.', 'info');
        await this.refresh();
        return;
      case 'installSkill':
        this.enqueue(() => this.installSkill(message.id));
        return;
      case 'uninstallSkill':
        this.enqueue(() => this.uninstallSkill(message.id));
        return;
      case 'applyProfile':
        this.enqueue(() => this.applyProfile(message.id));
        return;
      case 'removeProfile':
        this.enqueue(() => this.removeProfile());
        return;
      case 'openSource':
        await this.openSource(message.id);
        return;
      case 'openAgentsFile':
        await this.openAgentsFile();
        return;
      case 'revealAgentsFolder':
        await this.revealAgentsFolder();
        return;
    }
  }

  private enqueue(task: () => Promise<void>): void {
    this.operation = this.operation.then(task, task).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Something went wrong.';
      this.notice(message, 'error');
    });
  }

  private async installSkill(id: string): Promise<void> {
    const skill = this.state?.skills.find((item) => item.id === id);
    const service = this.service();
    if (!skill || !service) return;
    this.busy(id, true);
    try {
      const result = await service.installSkill(skill);
      const action = skill.installed ? 'Updated' : 'Installed';
      this.addActivity('install', `${action} ${skill.name}.`);
      this.notice(`${action} ${skill.name}.${result.backup ? ' Your previous copy was backed up.' : ''}`, 'success');
      await this.refresh();
    } finally {
      this.busy(id, false);
    }
  }

  private async uninstallSkill(id: string): Promise<void> {
    const skill = this.state?.skills.find((item) => item.id === id);
    const service = this.service();
    if (!skill || !service) return;
    this.busy(id, true);
    try {
      const result = await service.uninstallSkill(skill.destinationName);
      this.addActivity('remove', `Removed ${skill.name}.`);
      this.notice(`Removed ${skill.name}.${result.backup ? ' Your changed copy was backed up.' : ''}`, 'success');
      await this.refresh();
    } finally {
      this.busy(id, false);
    }
  }

  private async applyProfile(id: string): Promise<void> {
    const profile = this.state?.profiles.find((item) => item.id === id);
    const service = this.service();
    if (!profile || !service) return;
    this.busy(id, true);
    try {
      const result = await service.applyProfile(profile);
      this.addActivity('profile', `Installed ${profile.name} as AGENTS.md.`);
      this.notice(`Installed ${profile.name} as AGENTS.md.${result.backup ? ' Your previous file was backed up.' : ''}`, 'success');
      await this.refresh();
    } finally {
      this.busy(id, false);
    }
  }

  private async removeProfile(): Promise<void> {
    const active = this.state?.profiles.find((item) => item.active);
    const service = this.service();
    if (!service) return;
    const busyId = active?.id ?? 'active-profile';
    this.busy(busyId, true);
    try {
      const result = await service.removeActiveProfile();
      this.addActivity('remove', `Removed the ${active?.name ?? 'active'} AGENTS.md profile.`);
      this.notice(`Removed the active AGENTS.md.${result.backup ? ' Your changed file was backed up.' : ''}`, 'success');
      await this.refresh();
    } finally {
      this.busy(busyId, false);
    }
  }

  private async refresh(): Promise<void> {
    const workspaces = this.workspaceViews();
    const selected = this.selectedWorkspace(workspaces);
    this.selectedWorkspaceId = selected?.id;
    if (selected) await this.context.workspaceState.update('selectedWorkspaceId', selected.id);

    const skillsLibrary = this.skillsLibraryPath();
    const agentsLibrary = this.agentsLibraryPath();
    const [skillsValid, agentsValid] = await Promise.all([
      skillsLibrary ? isDirectory(skillsLibrary) : false,
      agentsLibrary ? isDirectory(agentsLibrary) : false
    ]);
    let skills: SkillView[] = [];
    let profiles: ProfileView[] = [];
    let workspaceReady = false;
    if (selected) {
      const service = new ToolboxService(selected.path);
      await service.ensureWorkspaceStructure();
      workspaceReady = true;
      const snapshot = await service.snapshot(skillsValid ? skillsLibrary : undefined, agentsValid ? agentsLibrary : undefined);
      skills = snapshot.skills;
      profiles = snapshot.profiles;
    }
    this.state = {
      workspaces,
      selectedWorkspaceId: selected?.id,
      workspaceReady,
      skillsLibrary: { path: skillsLibrary, valid: skillsValid },
      agentsLibrary: { path: agentsLibrary, valid: agentsValid },
      autoSync: this.configuration().get<boolean>('autoSync', true),
      skills,
      profiles,
      activities: this.activities,
      lastRefresh: new Date().toISOString()
    };
    await Promise.all([
      this.skillsWatcher.setPath(skillsValid ? skillsLibrary : undefined),
      this.agentsWatcher.setPath(agentsValid ? agentsLibrary : undefined)
    ]);
    this.resetWorkspaceWatchers();
    await this.view?.webview.postMessage({ type: 'state', state: this.state });
  }

  private workspaceViews(): WorkspaceView[] {
    return (vscode.workspace.workspaceFolders ?? [])
      .filter((folder) => folder.uri.scheme === 'file')
      .map((folder) => ({ id: folder.uri.toString(), name: folder.name, path: folder.uri.fsPath }));
  }

  private selectedWorkspace(workspaces = this.workspaceViews()): WorkspaceView | undefined {
    return workspaces.find((workspace) => workspace.id === this.selectedWorkspaceId) ?? workspaces[0];
  }

  private service(): ToolboxService | undefined {
    const selected = this.selectedWorkspace();
    return selected ? new ToolboxService(selected.path) : undefined;
  }

  private resetWorkspaceWatchers(): void {
    this.workspaceWatchers.forEach((watcher) => watcher.dispose());
    this.workspaceWatchers = [];
    const selected = this.selectedWorkspace();
    const folder = vscode.workspace.workspaceFolders?.find((candidate) => candidate.uri.toString() === selected?.id);
    if (!folder) return;
    for (const pattern of ['.agents/**', 'AGENTS.md']) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, pattern));
      watcher.onDidCreate(() => this.refreshSoon());
      watcher.onDidChange(() => this.refreshSoon());
      watcher.onDidDelete(() => this.refreshSoon());
      this.workspaceWatchers.push(watcher);
    }
  }

  private async chooseLibrary(key: 'skillsLibrary' | 'agentsLibrary', title: string): Promise<void> {
    const current = this.configuration().get<string>(key, '');
    const picked = await vscode.window.showOpenDialog({
      title,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: current ? vscode.Uri.file(current) : undefined,
      openLabel: 'Use this folder'
    });
    const selected = picked?.[0];
    if (!selected) return;
    await this.configuration().update(key, selected.fsPath, vscode.ConfigurationTarget.Global);
    this.addActivity('info', `${key === 'skillsLibrary' ? 'Skills' : 'AGENTS.md'} library connected.`);
    await this.refresh();
  }

  private async openSource(id: string): Promise<void> {
    const source = this.state?.profiles.find((item) => item.id === id)?.sourcePath
      ?? this.state?.skills.find((item) => item.id === id)?.sourcePath;
    if (!source) return;
    const uri = vscode.Uri.file(source);
    const stats = await vscode.workspace.fs.stat(uri);
    if (stats.type & vscode.FileType.Directory) {
      await vscode.commands.executeCommand('revealFileInOS', uri);
    } else {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
    }
  }

  private async openAgentsFile(): Promise<void> {
    const service = this.service();
    if (!service) return;
    try {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(service.agentsFile)));
    } catch {
      this.notice('Install an AGENTS.md profile first.', 'info');
    }
  }

  private async revealAgentsFolder(): Promise<void> {
    const service = this.service();
    if (!service) return;
    await service.ensureWorkspaceStructure();
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(service.agentsRoot));
  }

  private configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIG_SECTION);
  }

  private skillsLibraryPath(): string {
    return this.configuration().get<string>('skillsLibrary', '').trim();
  }

  private agentsLibraryPath(): string {
    return this.configuration().get<string>('agentsLibrary', '').trim();
  }

  private addActivity(kind: ActivityItem['kind'], message: string): void {
    this.activities.unshift({ id: `${Date.now()}-${Math.random()}`, kind, message, timestamp: new Date().toISOString() });
    this.activities.splice(8);
  }

  private busy(id: string, value: boolean): void {
    void this.view?.webview.postMessage({ type: 'busy', id, value });
  }

  private notice(message: string, tone: 'success' | 'error' | 'info'): void {
    void this.view?.webview.postMessage({ type: 'notice', message, tone });
  }

  private async firstDirectory(candidates: string[]): Promise<string | undefined> {
    for (const candidate of candidates) if (await isDirectory(candidate)) return path.resolve(candidate);
    return undefined;
  }

  public dispose(): void {
    this.skillsWatcher.dispose();
    this.agentsWatcher.dispose();
    this.workspaceWatchers.forEach((watcher) => watcher.dispose());
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }
}
