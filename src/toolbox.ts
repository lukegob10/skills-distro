import { promises as fs } from 'node:fs';
import path from 'node:path';
import { discoverProfiles, discoverSkills, readProfileBuffer } from './catalog';
import {
  isPathInside,
  pathExists,
  removePath,
  replaceDirectory,
  signatureForDirectory,
  signatureForFile,
  timestampedBackup,
  writeTextAtomic
} from './fileSystem';
import { loadManifest, saveManifest } from './manifest';
import type {
  ProfileSource,
  ProfileView,
  SkillSource,
  SkillView,
  SyncResult,
  ToolboxManifest
} from './model';

export interface CatalogSnapshot {
  skills: SkillView[];
  profiles: ProfileView[];
  manifest: ToolboxManifest;
}

export class ToolboxService {
  public constructor(private readonly workspaceRoot: string) {}

  public get agentsRoot(): string {
    return path.join(this.workspaceRoot, '.agents');
  }

  public get skillsRoot(): string {
    return path.join(this.agentsRoot, 'skills');
  }

  public get agentsFile(): string {
    return path.join(this.workspaceRoot, 'AGENTS.md');
  }

  public async ensureWorkspaceStructure(): Promise<void> {
    await fs.mkdir(this.skillsRoot, { recursive: true });
  }

  public async snapshot(skillsLibrary?: string, agentsLibrary?: string): Promise<CatalogSnapshot> {
    const [sources, profiles, manifest] = await Promise.all([
      discoverSkills(skillsLibrary),
      discoverProfiles(agentsLibrary),
      loadManifest(this.workspaceRoot)
    ]);
    const skills = await this.skillViews(sources, manifest);
    const profileViews = await this.profileViews(profiles, manifest);
    return { skills, profiles: profileViews, manifest };
  }

  private async skillViews(sources: SkillSource[], manifest: ToolboxManifest): Promise<SkillView[]> {
    const views = await Promise.all(sources.map(async (source): Promise<SkillView> => {
      const destination = this.skillDestination(source.destinationName);
      const exists = await pathExists(destination);
      const managed = manifest.skills[source.destinationName];
      if (!exists) return { ...source, state: 'available', installed: false };
      if (!managed || path.resolve(managed.sourcePath) !== path.resolve(source.sourcePath ?? '')) {
        return { ...source, state: 'modified', installed: true };
      }
      const installedSignature = await signatureForDirectory(destination);
      if (installedSignature !== managed.installedSignature) {
        return { ...source, state: 'modified', installed: true };
      }
      if (source.signature !== managed.sourceSignature) {
        return { ...source, state: 'update', installed: true };
      }
      return { ...source, state: 'installed', installed: true };
    }));

    const knownDestinations = new Set(sources.map((source) => source.destinationName));
    if (await pathExists(this.skillsRoot)) {
      const entries = await fs.readdir(this.skillsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || knownDestinations.has(entry.name)) continue;
        const destination = this.skillDestination(entry.name);
        views.push({
          id: `installed:${entry.name.toLowerCase()}`,
          name: entry.name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          description: 'Installed skill whose source is no longer in the selected library.',
          category: 'Installed only',
          groupId: '__installed_only__',
          groupName: 'Installed only',
          destinationName: entry.name,
          signature: await signatureForDirectory(destination),
          state: 'orphaned',
          installed: true
        });
      }
    }
    return views.sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name));
  }

  private async profileViews(sources: ProfileSource[], manifest: ToolboxManifest): Promise<ProfileView[]> {
    const active = manifest.activeProfile;
    const currentSignature = await signatureForFile(this.agentsFile).catch(() => '');
    return sources.map((source): ProfileView => {
      if (!active || path.resolve(active.sourcePath) !== path.resolve(source.sourcePath)) {
        return { ...source, state: 'available', active: false };
      }
      if (currentSignature !== active.appliedSignature) {
        return { ...source, state: 'modified', active: true };
      }
      if (source.signature !== active.sourceSignature) {
        return { ...source, state: 'update', active: true };
      }
      return { ...source, state: 'active', active: true };
    }).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  }

  public async installSkill(source: SkillSource): Promise<{ backup?: string }> {
    if (!source.sourcePath || !(await pathExists(source.sourcePath))) {
      throw new Error('This skill is no longer available in the selected library.');
    }
    await this.ensureWorkspaceStructure();
    const manifest = await loadManifest(this.workspaceRoot);
    const destination = this.skillDestination(source.destinationName);
    const existing = manifest.skills[source.destinationName];
    let backup: string | undefined;
    if (await pathExists(destination)) {
      const currentSignature = await signatureForDirectory(destination);
      if (!existing || currentSignature !== existing.installedSignature) {
        backup = await timestampedBackup(destination, path.join(this.agentsRoot, 'backups', 'skills'), source.destinationName);
      }
    }

    await replaceDirectory(source.sourcePath, destination);
    const now = new Date().toISOString();
    const installedSignature = await signatureForDirectory(destination);
    manifest.skills[source.destinationName] = {
      sourcePath: source.sourcePath,
      sourceSignature: source.signature,
      installedSignature,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now
    };
    await saveManifest(this.workspaceRoot, manifest);
    return { backup };
  }

  public async uninstallSkill(destinationName: string): Promise<{ backup?: string }> {
    const destination = this.skillDestination(destinationName);
    if (!(await pathExists(destination))) return {};
    const manifest = await loadManifest(this.workspaceRoot);
    const managed = manifest.skills[destinationName];
    const currentSignature = await signatureForDirectory(destination);
    let backup: string | undefined;
    if (!managed || currentSignature !== managed.installedSignature) {
      backup = await timestampedBackup(destination, path.join(this.agentsRoot, 'backups', 'skills'), destinationName);
    }
    await removePath(destination);
    delete manifest.skills[destinationName];
    await saveManifest(this.workspaceRoot, manifest);
    return { backup };
  }

  public async applyProfile(source: ProfileSource): Promise<{ backup?: string }> {
    if (!(await pathExists(source.sourcePath))) {
      throw new Error('This profile is no longer available in the selected library.');
    }
    await this.ensureWorkspaceStructure();
    const manifest = await loadManifest(this.workspaceRoot);
    let backup: string | undefined;
    if (await pathExists(this.agentsFile)) {
      const currentSignature = await signatureForFile(this.agentsFile);
      const isUnmodifiedManagedFile = manifest.activeProfile?.appliedSignature === currentSignature;
      if (!isUnmodifiedManagedFile) {
        backup = await timestampedBackup(this.agentsFile, path.join(this.agentsRoot, 'backups', 'agents'), 'AGENTS');
      }
    }
    await writeTextAtomic(this.agentsFile, await readProfileBuffer(source.sourcePath));
    const appliedSignature = await signatureForFile(this.agentsFile);
    manifest.activeProfile = {
      sourcePath: source.sourcePath,
      sourceSignature: source.signature,
      appliedSignature,
      appliedAt: new Date().toISOString()
    };
    await saveManifest(this.workspaceRoot, manifest);
    return { backup };
  }

  public async removeActiveProfile(): Promise<{ backup?: string }> {
    const manifest = await loadManifest(this.workspaceRoot);
    if (!(await pathExists(this.agentsFile))) {
      delete manifest.activeProfile;
      await saveManifest(this.workspaceRoot, manifest);
      return {};
    }
    const currentSignature = await signatureForFile(this.agentsFile);
    let backup: string | undefined;
    if (!manifest.activeProfile || manifest.activeProfile.appliedSignature !== currentSignature) {
      backup = await timestampedBackup(this.agentsFile, path.join(this.agentsRoot, 'backups', 'agents'), 'AGENTS');
    }
    await removePath(this.agentsFile);
    delete manifest.activeProfile;
    await saveManifest(this.workspaceRoot, manifest);
    return { backup };
  }

  public async syncManaged(skillsLibrary?: string, agentsLibrary?: string): Promise<SyncResult> {
    const [skills, profiles, manifest] = await Promise.all([
      discoverSkills(skillsLibrary),
      discoverProfiles(agentsLibrary),
      loadManifest(this.workspaceRoot)
    ]);
    const result: SyncResult = { skills: [] };
    for (const skill of skills) {
      const managed = manifest.skills[skill.destinationName];
      if (!managed || path.resolve(managed.sourcePath) !== path.resolve(skill.sourcePath ?? '')) continue;
      const destination = this.skillDestination(skill.destinationName);
      const currentSignature = await signatureForDirectory(destination);
      if (currentSignature !== managed.installedSignature || skill.signature === managed.sourceSignature) continue;
      await this.installSkill(skill);
      result.skills.push(skill.name);
    }

    const active = manifest.activeProfile;
    if (active) {
      const source = profiles.find((profile) => path.resolve(profile.sourcePath) === path.resolve(active.sourcePath));
      const currentSignature = await signatureForFile(this.agentsFile).catch(() => '');
      if (source && currentSignature === active.appliedSignature && source.signature !== active.sourceSignature) {
        await this.applyProfile(source);
        result.profile = source.name;
      }
    }
    return result;
  }

  private skillDestination(destinationName: string): string {
    const destination = path.join(this.skillsRoot, destinationName);
    if (!isPathInside(this.skillsRoot, destination)) {
      throw new Error('Invalid skill destination.');
    }
    return destination;
  }
}
