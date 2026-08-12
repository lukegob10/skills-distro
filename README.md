# Agentic Toolbox

Agentic Toolbox is a fast, fully local VS Code panel for reusable agent skills and named `AGENTS.md` profiles. Connect two folders once, then install a skill or switch the active workspace profile without leaving the Activity Bar.

## What it does

- Discovers every skill folder containing a `SKILL.md` file.
- Installs selected skills into `<workspace>/.agents/skills/<skill-name>`.
- Discovers descriptively named Markdown profiles and installs the selected one as the workspace-root `AGENTS.md`.
- Keeps exactly one profile active: installing another replaces the managed workspace `AGENTS.md`.
- Watches both external libraries and the current workspace for changes.
- Live-syncs toolbox-managed copies by default.
- Supports multi-root workspaces with an in-panel target selector.
- Keeps all content and state local. There is no account, authentication, telemetry, or network service.

The panel automatically creates `.agents/skills` when a local workspace is opened. Its small `toolbox.json` manifest distinguishes managed copies from files you authored yourself.

## Library layouts

The skills library uses one navigation level. Navigation folders become collapsible groups in the panel, and their child folders are skills:

```text
my-skills/
├── 01-dailies/
│   ├── email-writer/
│   │   ├── SKILL.md
│   │   └── references/
│   └── sip-agent/
│       └── SKILL.md
└── 02-frontend/
    └── angular/
        └── SKILL.md
```

Navigation folders start collapsed, remember which sections you open, and use natural filename order—so numeric prefixes are useful for deliberate ordering. Search temporarily reveals matching skills inside collapsed folders. Existing skills placed directly under `my-skills/` remain available in an **Ungrouped** section. Content deeper than `navigation-folder/skill/SKILL.md` is intentionally not flattened into the catalog.

Profiles can keep descriptive filenames or use nested `AGENTS.md` files:

```text
agents-family/
├── python.md
├── data-analysis.md
└── angular/
    └── AGENTS.md
```

The source filename stays unchanged. For example, installing `python-engineering.md` writes its content to `<workspace>/AGENTS.md`. YAML frontmatter is optional: `name` or `title` overrides the displayed profile name and `description` overrides its summary. Otherwise, named profiles use their filename; nested files literally named `AGENTS.md` use their folder name.

## Safety model

Live sync updates a managed copy only while its workspace content still matches the last version installed by the toolbox. If you edit that copy locally, the panel marks it as **Local changes** and stops overwriting it.

Before replacing or removing edited or unmanaged content, Agentic Toolbox saves a recoverable copy under:

```text
.agents/backups/
├── skills/
└── agents/
```

## Install locally

```powershell
npm install
npm run package
```

Then run **Extensions: Install from VSIX…** in VS Code and select the generated `agentic-toolbox-0.1.0.vsix` file.

On first open, use the folder controls in the panel to choose the skills and AGENTS.md libraries. When the conventional sibling folders exist, the extension detects them automatically.

## Develop

1. Open this repository in VS Code.
2. Run `npm install`.
3. Press `F5` to build and open an Extension Development Host.
4. Select the Agentic Toolbox sparkle icon in the Activity Bar.

Useful commands:

```powershell
npm run typecheck
npm test
npm run build
npm run check
```

The extension host is TypeScript bundled with esbuild. The panel is framework-free HTML, CSS, and JavaScript so activation and interaction stay immediate.

## Releases

Every push to `main` runs the complete typecheck, test, build, and packaging pipeline. A successful run publishes the generated VSIX as a GitHub Release asset using a unique tag such as `v0.1.5-build.12`.

Download the newest `.vsix` from the repository's Releases page, then install it from VS Code with **Extensions: Install from VSIX...**.
