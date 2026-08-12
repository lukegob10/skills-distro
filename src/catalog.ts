import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listFiles, pathExists, readText, signatureForDirectory, signatureForFile, toPosix } from './fileSystem';
import type { ProfileSource, SkillSource } from './model';

interface Metadata {
  name?: string;
  description?: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractFrontmatterMetadata(markdown: string): Metadata {
  const result: Metadata = {};
  const frontmatter = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!frontmatter?.[1]) return result;
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const match = line.match(/^\s*(name|title|description)\s*:\s*(.+?)\s*$/i);
    if (!match?.[1] || !match[2]) continue;
    const key = match[1].toLowerCase();
    if (key === 'name' || key === 'title') result.name ??= unquote(match[2]);
    if (key === 'description') result.description = unquote(match[2]);
  }
  return result;
}

export function extractMetadata(markdown: string): Metadata {
  const result = extractFrontmatterMetadata(markdown);
  const frontmatter = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  const body = frontmatter ? markdown.slice(frontmatter[0].length) : markdown;
  result.name ??= body.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();

  if (!result.description) {
    const paragraphs = body
      .replace(/```[\s\S]*?```/g, '')
      .split(/\r?\n\s*\r?\n/)
      .map((paragraph) => paragraph.replace(/^#{1,6}\s+.*$/gm, '').replace(/\s+/g, ' ').trim())
      .filter((paragraph) => paragraph && !paragraph.startsWith('<!--'));
    result.description = paragraphs[0]?.slice(0, 220);
  }
  return result;
}

function humanize(value: string): string {
  return value
    .replace(/\.md$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim() || 'Agent Profile';
}

export async function discoverSkills(libraryRoot?: string): Promise<SkillSource[]> {
  if (!libraryRoot) return [];
  let rootEntries;
  try {
    rootEntries = await fs.readdir(libraryRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates: Array<{ skillFile: string; groupId: string; groupName: string }> = [];
  for (const rootEntry of rootEntries) {
    if (!rootEntry.isDirectory() || rootEntry.name.startsWith('.')) continue;
    const rootEntryPath = path.join(libraryRoot, rootEntry.name);
    const directSkillFile = path.join(rootEntryPath, 'SKILL.md');
    if (await pathExists(directSkillFile)) {
      candidates.push({ skillFile: directSkillFile, groupId: '__ungrouped__', groupName: 'Ungrouped' });
      continue;
    }

    let skillEntries;
    try {
      skillEntries = await fs.readdir(rootEntryPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const skillEntry of skillEntries) {
      if (!skillEntry.isDirectory() || skillEntry.name.startsWith('.')) continue;
      const skillFile = path.join(rootEntryPath, skillEntry.name, 'SKILL.md');
      if (await pathExists(skillFile)) {
        candidates.push({
          skillFile,
          groupId: toPosix(rootEntry.name).toLowerCase(),
          groupName: humanize(rootEntry.name)
        });
      }
    }
  }

  const skills = await Promise.all(candidates.map(async ({ skillFile, groupId, groupName }) => {
    const sourcePath = path.dirname(skillFile);
    const relative = path.relative(libraryRoot, sourcePath);
    const markdown = await readText(skillFile);
    const metadata = extractMetadata(markdown);
    return {
      id: toPosix(relative).toLowerCase(),
      name: metadata.name || humanize(path.basename(sourcePath)),
      description: metadata.description || 'Local agent skill',
      category: groupName,
      groupId,
      groupName,
      sourcePath,
      destinationName: path.basename(sourcePath),
      signature: await signatureForDirectory(sourcePath)
    };
  }));
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return skills.sort((first, second) =>
    collator.compare(first.groupName, second.groupName) || collator.compare(first.name, second.name)
  );
}

export async function discoverProfiles(libraryRoot?: string): Promise<ProfileSource[]> {
  if (!libraryRoot) return [];
  const profileFiles = await listFiles(libraryRoot, {
    maxDepth: 5,
    include: (file) => file.toLowerCase().endsWith('.md') && path.basename(file).toLowerCase() !== 'readme.md'
  });

  return Promise.all(profileFiles.map(async (sourcePath) => {
    const relative = path.relative(libraryRoot, sourcePath);
    const segments = relative.split(path.sep);
    const markdown = await readText(sourcePath);
    const metadata = extractMetadata(markdown);
    const explicitMetadata = extractFrontmatterMetadata(markdown);
    const isGenericAgentsFile = path.basename(sourcePath).toLowerCase() === 'agents.md';
    const fallbackName = isGenericAgentsFile
      ? humanize(segments.at(-2) ?? 'Agent Profile')
      : humanize(path.basename(sourcePath));
    return {
      id: toPosix(relative).toLowerCase(),
      name: explicitMetadata.name || fallbackName,
      description: metadata.description || 'Workspace agent instructions',
      category: segments.length > 1 ? humanize(segments.slice(0, -1).join(' / ')) : 'Profiles',
      sourcePath,
      destinationName: 'AGENTS.md',
      signature: await signatureForFile(sourcePath),
      preview: markdown.slice(0, 2_400)
    };
  }));
}

export async function readProfileBuffer(sourcePath: string): Promise<Buffer> {
  return fs.readFile(sourcePath);
}
