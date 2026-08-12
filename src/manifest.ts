import { promises as fs } from 'node:fs';
import path from 'node:path';
import { MANIFEST_VERSION, type ToolboxManifest } from './model';
import { writeJsonAtomic } from './fileSystem';

export function emptyManifest(): ToolboxManifest {
  return { version: MANIFEST_VERSION, skills: {} };
}

export function manifestPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.agents', 'toolbox.json');
}

export async function loadManifest(workspaceRoot: string): Promise<ToolboxManifest> {
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath(workspaceRoot), 'utf8')) as Partial<ToolboxManifest>;
    if (parsed.version !== MANIFEST_VERSION || typeof parsed.skills !== 'object' || parsed.skills === null) {
      return emptyManifest();
    }
    return { ...parsed, version: MANIFEST_VERSION, skills: parsed.skills } as ToolboxManifest;
  } catch {
    return emptyManifest();
  }
}

export async function saveManifest(workspaceRoot: string, manifest: ToolboxManifest): Promise<void> {
  await writeJsonAtomic(manifestPath(workspaceRoot), manifest);
}
