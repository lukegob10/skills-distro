import { watch, type FSWatcher } from 'node:fs';
import { isDirectory } from './fileSystem';

export class DebouncedFolderWatcher {
  private watcher?: FSWatcher;
  private debounceTimer?: NodeJS.Timeout;
  private pollTimer?: NodeJS.Timeout;
  private watchedPath?: string;

  public constructor(
    private readonly onChange: () => void,
    private readonly debounceMs = 300,
    private readonly pollMs = 5_000
  ) {}

  public async setPath(folderPath?: string): Promise<void> {
    if (folderPath === this.watchedPath) return;
    this.stop();
    this.watchedPath = folderPath;
    if (!folderPath || !(await isDirectory(folderPath))) return;

    try {
      this.watcher = watch(folderPath, { recursive: true }, () => this.schedule());
      this.watcher.on('error', () => this.startPolling());
    } catch {
      this.startPolling();
    }
  }

  private schedule(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.onChange();
    }, this.debounceMs);
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.watcher?.close();
    this.watcher = undefined;
    this.pollTimer = setInterval(() => this.schedule(), this.pollMs);
  }

  private stop(): void {
    this.watcher?.close();
    this.watcher = undefined;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.debounceTimer = undefined;
    this.pollTimer = undefined;
  }

  public dispose(): void {
    this.stop();
  }
}
