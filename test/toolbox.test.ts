import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverProfiles, discoverSkills } from '../src/catalog';
import { pathExists } from '../src/fileSystem';
import { ToolboxService } from '../src/toolbox';

describe('ToolboxService', () => {
  let temporaryRoot: string;
  let workspaceRoot: string;
  let skillsLibrary: string;
  let profilesLibrary: string;

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentic-toolbox-'));
    workspaceRoot = path.join(temporaryRoot, 'workspace');
    skillsLibrary = path.join(temporaryRoot, 'skills-library');
    profilesLibrary = path.join(temporaryRoot, 'profiles-library');
    await Promise.all([
      fs.mkdir(workspaceRoot, { recursive: true }),
      fs.mkdir(path.join(skillsLibrary, 'communication', 'email-writer'), { recursive: true }),
      fs.mkdir(profilesLibrary, { recursive: true })
    ]);
    await fs.writeFile(
      path.join(skillsLibrary, 'communication', 'email-writer', 'SKILL.md'),
      '---\nname: Email Writer\ndescription: Drafts useful emails.\n---\n# Email Writer\n',
      'utf8'
    );
    await fs.writeFile(
      path.join(skillsLibrary, 'communication', 'email-writer', 'template.md'),
      'Version one',
      'utf8'
    );
    await fs.writeFile(
      path.join(profilesLibrary, 'precision-python-reviewer.md'),
      '# AGENTS.md\n\nUse type hints.',
      'utf8'
    );
  });

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  it('discovers, installs, live-syncs, and uninstalls a managed skill', async () => {
    const service = new ToolboxService(workspaceRoot);
    const [skill] = await discoverSkills(skillsLibrary);
    expect(skill?.name).toBe('Email Writer');
    expect(skill?.category).toBe('Communication');
    expect(skill?.groupName).toBe('Communication');
    if (!skill) throw new Error('Fixture skill was not discovered.');

    await service.installSkill(skill);
    const installedTemplate = path.join(workspaceRoot, '.agents', 'skills', 'email-writer', 'template.md');
    expect(await fs.readFile(installedTemplate, 'utf8')).toBe('Version one');

    await fs.writeFile(path.join(skillsLibrary, 'communication', 'email-writer', 'template.md'), 'Version two', 'utf8');
    const synced = await service.syncManaged(skillsLibrary, profilesLibrary);
    expect(synced.skills).toEqual(['Email Writer']);
    expect(await fs.readFile(installedTemplate, 'utf8')).toBe('Version two');

    await service.uninstallSkill('email-writer');
    expect(await pathExists(path.dirname(installedTemplate))).toBe(false);
  });

  it('does not auto-sync over workspace edits and backs them up before removal', async () => {
    const service = new ToolboxService(workspaceRoot);
    const [skill] = await discoverSkills(skillsLibrary);
    if (!skill) throw new Error('Fixture skill was not discovered.');
    await service.installSkill(skill);

    const installedTemplate = path.join(workspaceRoot, '.agents', 'skills', 'email-writer', 'template.md');
    await fs.writeFile(installedTemplate, 'Workspace edit', 'utf8');
    await fs.writeFile(path.join(skillsLibrary, 'communication', 'email-writer', 'template.md'), 'Library edit', 'utf8');
    const synced = await service.syncManaged(skillsLibrary, profilesLibrary);
    expect(synced.skills).toEqual([]);
    expect(await fs.readFile(installedTemplate, 'utf8')).toBe('Workspace edit');

    const removed = await service.uninstallSkill('email-writer');
    expect(removed.backup).toBeTruthy();
    expect(await fs.readFile(path.join(removed.backup ?? '', 'template.md'), 'utf8')).toBe('Workspace edit');
  });

  it('applies profiles and preserves an edited AGENTS.md before switching', async () => {
    const service = new ToolboxService(workspaceRoot);
    const [python] = await discoverProfiles(profilesLibrary);
    if (!python) throw new Error('Fixture profile was not discovered.');
    expect(python.name).toBe('Precision Python Reviewer');
    expect(python.destinationName).toBe('AGENTS.md');
    await service.applyProfile(python);
    expect(await fs.readFile(path.join(workspaceRoot, 'AGENTS.md'), 'utf8')).toContain('Use type hints.');
    expect(await pathExists(path.join(workspaceRoot, 'precision-python-reviewer.md'))).toBe(false);

    await fs.writeFile(path.join(workspaceRoot, 'AGENTS.md'), '# Custom workspace rules', 'utf8');
    const goPath = path.join(profilesLibrary, 'go-service-standards.md');
    await fs.writeFile(goPath, '# Go Standards\n\nKeep interfaces small.', 'utf8');
    const profiles = await discoverProfiles(profilesLibrary);
    const go = profiles.find((profile) => profile.name === 'Go Service Standards');
    if (!go) throw new Error('Go fixture was not discovered.');
    const applied = await service.applyProfile(go);

    expect(applied.backup).toBeTruthy();
    expect(await fs.readFile(applied.backup ?? '', 'utf8')).toBe('# Custom workspace rules');
    expect(await fs.readFile(path.join(workspaceRoot, 'AGENTS.md'), 'utf8')).toContain('Keep interfaces small.');
  });

  it('creates the expected workspace structure on first use', async () => {
    const service = new ToolboxService(workspaceRoot);
    await service.ensureWorkspaceStructure();
    expect(await pathExists(path.join(workspaceRoot, '.agents', 'skills'))).toBe(true);
  });
});
