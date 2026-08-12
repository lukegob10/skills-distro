import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverSkills, extractMetadata } from '../src/catalog';

describe('extractMetadata', () => {
  it('prefers frontmatter metadata', () => {
    expect(extractMetadata(`---
name: "Email Writer"
description: Writes concise business email.
---
# Ignored title

Ignored paragraph.`)).toEqual({
      name: 'Email Writer',
      description: 'Writes concise business email.'
    });
  });

  it('falls back to the heading and first paragraph', () => {
    expect(extractMetadata('# Python Standards\n\nUse clear types and small modules.')).toEqual({
      name: 'Python Standards',
      description: 'Use clear types and small modules.'
    });
  });
});

describe('discoverSkills', () => {
  it('discovers only root skills and group/skill folders in natural group order', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentic-toolbox-catalog-'));
    try {
      const fixtures = [
        ['10-specialized', 'research', 'Research'],
        ['02-development', 'angular', 'Angular'],
        ['01-dailies', 'sip-agent', 'SIP Agent'],
        ['01-dailies', 'email', 'Email'],
        ['standalone', null, 'Standalone']
      ] as const;
      for (const [group, skill, name] of fixtures) {
        const skillRoot = skill ? path.join(root, group, skill) : path.join(root, group);
        await fs.mkdir(skillRoot, { recursive: true });
        await fs.writeFile(path.join(skillRoot, 'SKILL.md'), `# ${name}\n\n${name} description.`, 'utf8');
      }
      const tooDeep = path.join(root, '03-ignored', 'intermediate', 'too-deep');
      await fs.mkdir(tooDeep, { recursive: true });
      await fs.writeFile(path.join(tooDeep, 'SKILL.md'), '# Too Deep', 'utf8');

      const skills = await discoverSkills(root);
      expect(skills.map((skill) => `${skill.groupName}:${skill.name}`)).toEqual([
        '01 Dailies:Email',
        '01 Dailies:SIP Agent',
        '02 Development:Angular',
        '10 Specialized:Research',
        'Ungrouped:Standalone'
      ]);
      expect(skills.some((skill) => skill.name === 'Too Deep')).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
