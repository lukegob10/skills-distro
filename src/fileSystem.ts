import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const IGNORED_NAMES = new Set([
  '.DS_Store',
  '.git',
  '.svn',
  'node_modules',
  '__pycache__'
]);

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

export function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function listFiles(
  root: string,
  options: { maxDepth?: number; include?: (filePath: string) => boolean } = {}
): Promise<string[]> {
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const files: string[] = [];

  async function visit(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(entries.map(async (entry) => {
      if (IGNORED_NAMES.has(entry.name)) return;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath, depth + 1);
      } else if (entry.isFile() && (!options.include || options.include(entryPath))) {
        files.push(entryPath);
      }
    }));
  }

  await visit(root, 0);
  return files.sort((a, b) => a.localeCompare(b));
}

export async function signatureForFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await fs.readFile(filePath));
  return hash.digest('hex');
}

export async function signatureForDirectory(root: string): Promise<string> {
  if (!(await pathExists(root))) return '';
  const files = await listFiles(root);
  const hash = createHash('sha256');
  for (const file of files) {
    const stats = await fs.stat(file);
    hash.update(toPosix(path.relative(root, file)));
    hash.update('\0');
    hash.update(String(stats.size));
    hash.update('\0');
    hash.update(String(stats.mtimeMs));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function readText(filePath: string, maxBytes = 256_000): Promise<string> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filePath);
}

export async function replaceDirectory(source: string, destination: string): Promise<void> {
  const parent = path.dirname(destination);
  const stagingRoot = path.join(parent, '.toolbox-staging');
  const token = randomUUID();
  const staged = path.join(stagingRoot, `${path.basename(destination)}.${token}.new`);
  const previous = path.join(stagingRoot, `${path.basename(destination)}.${token}.previous`);
  await fs.mkdir(stagingRoot, { recursive: true });

  try {
    await fs.cp(source, staged, { recursive: true, force: true, errorOnExist: false });
    const hadDestination = await pathExists(destination);
    if (hadDestination) await fs.rename(destination, previous);
    try {
      await fs.rename(staged, destination);
    } catch (error) {
      if (hadDestination && await pathExists(previous)) await fs.rename(previous, destination);
      throw error;
    }
    if (hadDestination) await fs.rm(previous, { recursive: true, force: true });
  } finally {
    await fs.rm(staged, { recursive: true, force: true });
    await fs.rm(previous, { recursive: true, force: true });
    try {
      const remaining = await fs.readdir(stagingRoot);
      if (remaining.length === 0) await fs.rmdir(stagingRoot);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

export async function timestampedBackup(source: string, backupRoot: string, label: string): Promise<string> {
  await fs.mkdir(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(backupRoot, `${label}.${stamp}`);
  const stats = await fs.stat(source);
  if (stats.isDirectory()) {
    await fs.cp(source, destination, { recursive: true, force: false });
  } else {
    await fs.copyFile(source, `${destination}.md`);
    return `${destination}.md`;
  }
  return destination;
}

export async function removePath(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
}

export async function writeTextAtomic(filePath: string, content: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, content);
  await fs.rename(temporary, filePath);
}
