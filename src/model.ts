export const MANIFEST_VERSION = 1 as const;

export type SkillState =
  | 'available'
  | 'installed'
  | 'update'
  | 'modified'
  | 'orphaned';

export type ProfileState = 'available' | 'active' | 'update' | 'modified';

export interface SkillSource {
  id: string;
  name: string;
  description: string;
  category: string;
  groupId: string;
  groupName: string;
  sourcePath?: string;
  destinationName: string;
  signature: string;
}

export interface SkillView extends SkillSource {
  state: SkillState;
  installed: boolean;
}

export interface ProfileSource {
  id: string;
  name: string;
  description: string;
  category: string;
  sourcePath: string;
  destinationName: 'AGENTS.md';
  signature: string;
  preview: string;
}

export interface ProfileView extends ProfileSource {
  state: ProfileState;
  active: boolean;
}

export interface ManagedSkill {
  sourcePath: string;
  sourceSignature: string;
  installedSignature: string;
  installedAt: string;
  updatedAt: string;
}

export interface ManagedProfile {
  sourcePath: string;
  sourceSignature: string;
  appliedSignature: string;
  appliedAt: string;
}

export interface ToolboxManifest {
  version: typeof MANIFEST_VERSION;
  skills: Record<string, ManagedSkill>;
  activeProfile?: ManagedProfile;
}

export interface SyncResult {
  skills: string[];
  profile?: string;
}

export interface ActivityItem {
  id: string;
  kind: 'install' | 'remove' | 'profile' | 'sync' | 'info';
  message: string;
  timestamp: string;
}
