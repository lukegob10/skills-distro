(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const toastRegion = document.getElementById('toast-region');
  const saved = vscode.getState() || {};
  let state;
  let activeTab = saved.activeTab || 'skills';
  let query = '';
  let settingsOpen = false;
  const busy = new Set();
  const expandedProfiles = new Set(saved.expandedProfiles || []);
  const expandedSkillGroups = new Set(saved.expandedSkillGroupsV2 || []);

  const icons = {
    brand: '<path d="M12 3.2a8.8 8.8 0 0 1 7.45 4.1M20.2 11.3a8.8 8.8 0 0 1-5.7 9.1M10.2 20.6a8.8 8.8 0 0 1-6.9-7.5M3.8 9A8.8 8.8 0 0 1 8.4 3.95"/><path d="m12 8.15 1.15 2.7L15.85 12l-2.7 1.15L12 15.85l-1.15-2.7L8.15 12l2.7-1.15L12 8.15Z" fill="currentColor" stroke="none"/>',
    spark: '<path d="m12 2 1.1 3.4L16.5 6.5l-3.4 1.1L12 11l-1.1-3.4-3.4-1.1 3.4-1.1L12 2Z"/><path d="m18.25 12 .7 2.05 2.05.7-2.05.7-.7 2.05-.7-2.05-2.05-.7 2.05-.7.7-2.05Z"/><path d="m6.25 13 .7 2.05 2.05.7-2.05.7-.7 2.05-.7-2.05-2.05-.7 2.05-.7.7-2.05Z"/>',
    file: '<path d="M6 2.75h7l5 5v13.5H6z"/><path d="M13 2.75v5h5M9 12h6M9 15.5h6"/>',
    folder: '<path d="M3 6.5h6l1.5 2H21v10.75H3z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.25 4.25"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.18.37.48.72.85.95.33.2.72.31 1.15.31h.1v4h-.1A1.7 1.7 0 0 0 19.4 15Z"/>',
    refresh: '<path d="M20 6v5h-5"/><path d="M18.15 16.5A8 8 0 1 1 19.8 9"/>',
    external: '<path d="M13 4h7v7M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
    check: '<path d="m5 12.5 4.25 4.25L19 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4.5 7h15M9 7V4.5h6V7M7 7l1 13h8l1-13M10 10.5v6M14 10.5v6"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
    bolt: '<path d="m13.5 2-8 12h6l-1 8 8-12h-6z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>'
  };

  function icon(name, size = 16) {
    return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.spark}</svg>`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function shortPath(value) {
    if (!value) return 'Not connected';
    const segments = value.split(/[\\/]/).filter(Boolean);
    return segments.slice(-2).join(' / ');
  }

  function labelForState(item) {
    const labels = {
      available: '',
      installed: 'Installed',
      active: 'Active',
      update: 'Update ready',
      modified: item.active ? 'Edited locally' : 'Local changes',
      orphaned: 'Source missing'
    };
    return labels[item.state] || '';
  }

  function post(type, payload = {}) {
    vscode.postMessage({ type, ...payload });
  }

  function persist() {
    vscode.setState({
      activeTab,
      expandedProfiles: [...expandedProfiles],
      expandedSkillGroupsV2: [...expandedSkillGroups]
    });
  }

  function render() {
    if (!state) return;

    app.innerHTML = `
      <div class="shell">
        <header class="topbar">
          <div class="brand">
            <div class="brand-mark">${icon('brand', 21)}</div>
            <div><h1>Agentic Toolbox</h1><p>Skills · AGENTS.md</p></div>
          </div>
          <div class="top-actions">
            <button class="icon-button" data-action="refresh" aria-label="Refresh">${icon('refresh')}</button>
            <button class="icon-button ${settingsOpen ? 'selected' : ''}" data-action="settings" aria-label="Toolbox settings">${icon('settings')}</button>
          </div>
        </header>

        ${state.workspaces.length ? '' : renderNoWorkspace()}

        ${state.workspaces.length ? `
          ${state.workspaces.length > 1 ? `<label class="workspace-picker">${icon('folder', 14)}<select id="workspace-select" aria-label="Target workspace">${state.workspaces.map((workspace) => `<option value="${escapeHtml(workspace.id)}" ${workspace.id === state.selectedWorkspaceId ? 'selected' : ''}>${escapeHtml(workspace.name)}</option>`).join('')}</select>${icon('chevron', 12)}</label>` : ''}

          <nav class="tabs" aria-label="Toolbox sections">
            <button class="tab ${activeTab === 'skills' ? 'active' : ''}" data-tab="skills">Skills <span>${state.skills.length}</span></button>
            <button class="tab ${activeTab === 'profiles' ? 'active' : ''}" data-tab="profiles">AGENTS.md <span>${state.profiles.length}</span></button>
          </nav>

          <section class="content-head">
            <div class="source-row">
              <span class="source-icon ${currentLibrary().valid ? 'connected' : ''}">${icon('folder')}</span>
              <button class="source-button" data-action="${activeTab === 'skills' ? 'chooseSkillsLibrary' : 'chooseAgentsLibrary'}">
                <span>${activeTab === 'skills' ? 'Skills folder' : 'Profiles folder'}</span>
                <strong title="${escapeHtml(currentLibrary().path)}">${escapeHtml(shortPath(currentLibrary().path))}</strong>
              </button>
              <button class="change-button" data-action="${activeTab === 'skills' ? 'chooseSkillsLibrary' : 'chooseAgentsLibrary'}">Change</button>
            </div>
            <label class="search-box">${icon('search')}<input id="search-input" type="search" placeholder="Search ${activeTab === 'skills' ? 'skills' : 'profiles'}…" value="${escapeHtml(query)}" aria-label="Search"></label>
          </section>

          <section id="library-content" class="library-content"></section>
          ${renderFooter()}
        ` : ''}
      </div>
      ${settingsOpen ? renderSettings() : ''}
    `;
    renderLibrary();
  }

  function renderNoWorkspace() {
    return `<section class="hero-empty">
      <div class="empty-art">${icon('brand', 28)}<span>${icon('spark', 14)}</span></div>
      <h2>Open a project to begin</h2>
      <p>The toolbox creates <code>.agents/skills</code> inside your workspace and keeps it ready.</p>
    </section>`;
  }

  function currentLibrary() {
    return activeTab === 'skills' ? state.skillsLibrary : state.agentsLibrary;
  }

  function renderLibrary() {
    const container = document.getElementById('library-content');
    if (!container) return;
    const library = currentLibrary();
    const policy = activeTab === 'profiles' ? renderProfilePolicy() : '';
    if (!library.valid) {
      container.innerHTML = `${policy}<div class="empty-state">
        <div class="empty-icon">${icon(activeTab === 'skills' ? 'bolt' : 'file', 22)}</div>
        <h3>Connect your ${activeTab === 'skills' ? 'skills' : 'AGENTS.md'} library</h3>
        <p>Choose the local folder that contains your reusable ${activeTab === 'skills' ? 'SKILL.md folders' : 'named Markdown profiles'}.</p>
        <button class="primary-button" data-action="${activeTab === 'skills' ? 'chooseSkillsLibrary' : 'chooseAgentsLibrary'}">${icon('folder')} Choose folder</button>
      </div>`;
      return;
    }

    const items = activeTab === 'skills' ? state.skills : state.profiles;
    const normalized = query.trim().toLowerCase();
    const filtered = items.filter((item) => !normalized || `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(normalized));
    if (!items.length) {
      container.innerHTML = `${policy}<div class="empty-state compact">
        <div class="empty-icon">${icon(activeTab === 'skills' ? 'bolt' : 'file', 22)}</div>
        <h3>No ${activeTab === 'skills' ? 'skills' : 'profiles'} found yet</h3>
        <p>Add ${activeTab === 'skills' ? 'a folder containing SKILL.md' : 'Markdown files'} to <strong>${escapeHtml(shortPath(library.path))}</strong>. It will appear here automatically.</p>
      </div>`;
      return;
    }
    if (!filtered.length) {
      container.innerHTML = `${policy}<div class="empty-state compact"><div class="empty-icon">${icon('search', 22)}</div><h3>No matches</h3><p>Try a different name or keyword.</p></div>`;
      return;
    }
    container.innerHTML = activeTab === 'skills'
      ? renderSkillGroups(filtered)
      : `${policy}<div class="card-list">${filtered.map(renderProfile).join('')}</div>`;
  }

  function renderProfilePolicy() {
    return `<div class="profile-policy"><span class="policy-mark">${icon('brand', 14)}</span><div><strong>One profile at a time</strong><span>Installing a new one replaces AGENTS.md.</span></div></div>`;
  }

  function renderSkillGroups(skills) {
    const groups = new Map();
    for (const skill of skills) {
      const groupId = skill.groupId || skill.category || '__ungrouped__';
      const groupName = skill.groupName || skill.category || 'Ungrouped';
      if (!groups.has(groupId)) groups.set(groupId, { id: groupId, name: groupName, skills: [] });
      groups.get(groupId).skills.push(skill);
    }
    const sortedGroups = [...groups.values()].sort((first, second) =>
      first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    return `<div class="skill-groups">${sortedGroups.map((group) => {
      group.skills.sort((first, second) => first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: 'base' }));
      const expanded = Boolean(query.trim()) || expandedSkillGroups.has(group.id);
      return `<section class="skill-group ${expanded ? 'expanded' : 'collapsed'}">
        <button class="group-header" data-action="toggleSkillGroup" data-group-id="${escapeHtml(group.id)}" aria-expanded="${expanded}">
          <span class="group-folder">${icon('folder', 15)}</span>
          <span class="group-name">${escapeHtml(group.name)}</span>
          <span class="group-count" aria-label="${group.skills.length} skill${group.skills.length === 1 ? '' : 's'}">${group.skills.length}</span>
          <span class="group-chevron">${icon('chevron', 13)}</span>
        </button>
        ${expanded ? `<div class="card-list group-cards">${group.skills.map(renderSkill).join('')}</div>` : ''}
      </section>`;
    }).join('')}</div>`;
  }

  function renderSkill(skill) {
    const isBusy = busy.has(skill.id);
    const status = labelForState(skill);
    const tooltipId = `skill-tooltip-${encodeURIComponent(skill.id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
    let actions = '';
    if (skill.state === 'available') {
      actions = `<button class="card-action primary" data-action="installSkill" data-id="${escapeHtml(skill.id)}" ${isBusy ? 'disabled' : ''}>${isBusy ? spinner() : `${icon('plus')} Install`}</button>`;
    } else if (skill.state === 'update' || skill.state === 'modified') {
      actions = `<button class="card-action primary" data-action="installSkill" data-id="${escapeHtml(skill.id)}" ${isBusy ? 'disabled' : ''}>${isBusy ? spinner() : `${icon('refresh')} ${skill.state === 'update' ? 'Update' : 'Replace'}`}</button>
        <button class="icon-button danger" data-action="uninstallSkill" data-id="${escapeHtml(skill.id)}" aria-label="Remove ${escapeHtml(skill.name)}">${icon('trash')}</button>`;
    } else {
      actions = `<button class="card-action subtle remove" data-action="uninstallSkill" data-id="${escapeHtml(skill.id)}" ${isBusy ? 'disabled' : ''}>${isBusy ? spinner() : `${icon('trash')} Remove`}</button>`;
    }
    return `<article class="tool-card skill-card ${skill.installed ? 'installed' : ''}">
      <div class="card-icon skill">${icon('bolt', 18)}</div>
      <div class="card-body">
        <div class="card-title-line"><div class="skill-name-wrap" data-skill-tooltip="${escapeHtml(skill.id)}"><h3 tabindex="0" aria-describedby="${tooltipId}">${escapeHtml(skill.name)}</h3><div class="skill-tooltip" id="${tooltipId}" role="tooltip">${escapeHtml(skill.description)}</div></div>${status ? `<span class="state-badge ${skill.state}">${escapeHtml(status)}</span>` : ''}</div>
        <div class="card-footer"><div class="card-links">${skill.sourcePath ? `<button class="text-button" data-action="openSource" data-id="${escapeHtml(skill.id)}">${icon('external', 12)} Source</button>` : ''}</div><div class="card-actions">${actions}</div></div>
      </div>
    </article>`;
  }

  function renderProfile(profile) {
    const isBusy = busy.has(profile.id);
    const expanded = expandedProfiles.has(profile.id);
    const status = labelForState(profile);
    const button = profile.active && profile.state === 'active'
      ? `<button class="card-action subtle" data-action="openAgentsFile">${icon('external')} Open</button><button class="icon-button danger" data-action="removeProfile" aria-label="Remove active AGENTS.md">${icon('trash')}</button>`
      : `<button class="card-action ${profile.active ? 'primary' : 'secondary'}" data-action="applyProfile" data-id="${escapeHtml(profile.id)}" ${isBusy ? 'disabled' : ''}>${isBusy ? spinner() : `${profile.active ? icon('refresh') : icon('plus')} ${profile.active ? 'Update' : 'Install'}`}</button>`;
    return `<article class="tool-card profile ${profile.active ? 'installed' : ''}">
      <div class="card-icon profile">${icon('file', 18)}</div>
      <div class="card-body">
        <div class="card-title-line"><h3>${escapeHtml(profile.name)}</h3>${status ? `<span class="state-badge ${profile.state}">${escapeHtml(status)}</span>` : ''}</div>
        <p>${escapeHtml(profile.description)}</p>
        <div class="card-footer"><div class="card-links"><button class="text-button" data-action="preview" data-id="${escapeHtml(profile.id)}">${icon('eye', 12)} ${expanded ? 'Hide' : 'Preview'}</button><button class="text-button" data-action="openSource" data-id="${escapeHtml(profile.id)}">${icon('external', 12)} Source</button></div><div class="card-actions">${button}</div></div>
        ${expanded ? `<pre class="profile-preview">${escapeHtml(profile.preview)}</pre>` : ''}
      </div>
    </article>`;
  }

  function spinner() {
    return '<span class="spinner" aria-label="Working"></span>';
  }

  function renderFooter() {
    return `<footer class="status-footer"><span class="pulse ${state.autoSync ? 'on' : ''}"></span>${state.autoSync ? 'Live sync on' : 'Live sync paused'}</footer>`;
  }

  function renderSettings() {
    return `<div class="scrim" data-action="closeSettings"></div><aside class="settings-panel" aria-label="Toolbox settings">
      <div class="settings-head"><div><span>Preferences</span><h2>Toolbox settings</h2></div><button class="icon-button" data-action="closeSettings" aria-label="Close settings">${icon('close')}</button></div>
      <div class="setting-row"><div class="setting-copy"><span class="setting-icon">${icon('bolt')}</span><div><strong>Live sync</strong><p>Update managed copies when their source changes.</p></div></div><button class="switch ${state.autoSync ? 'on' : ''}" role="switch" aria-checked="${state.autoSync}" data-action="toggleAutoSync"><span></span></button></div>
      <div class="settings-group"><span>Libraries</span>
        <button class="settings-link" data-action="chooseSkillsLibrary">${icon('folder')}<div><strong>Skills</strong><small>${escapeHtml(shortPath(state.skillsLibrary.path))}</small></div>${icon('chevron')}</button>
        <button class="settings-link" data-action="chooseAgentsLibrary">${icon('folder')}<div><strong>AGENTS.md profiles</strong><small>${escapeHtml(shortPath(state.agentsLibrary.path))}</small></div>${icon('chevron')}</button>
      </div>
      <div class="settings-group"><span>Workspace</span>
        <button class="settings-link" data-action="revealAgentsFolder">${icon('external')}<div><strong>Reveal .agents</strong><small>Open the managed workspace folder</small></div></button>
        <button class="settings-link" data-action="openAgentsFile">${icon('file')}<div><strong>Open AGENTS.md</strong><small>Edit the active profile</small></div></button>
      </div>
      <div class="safety-note">${icon('clock')}<p><strong>Automatic recovery.</strong> Changed workspace files are backed up before replacement or removal.</p></div>
    </aside>`;
  }

  function showToast(message, tone) {
    const toast = document.createElement('div');
    toast.className = `toast ${tone}`;
    toast.innerHTML = `<span>${icon(tone === 'error' ? 'close' : tone === 'success' ? 'check' : 'spark')}</span><p>${escapeHtml(message)}</p>`;
    toastRegion.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 200);
    }, 4200);
  }

  app.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      activeTab = tab.dataset.tab;
      query = '';
      persist();
      render();
      window.scrollTo(0, 0);
      return;
    }
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    if (action === 'settings') {
      settingsOpen = !settingsOpen;
      render();
    } else if (action === 'closeSettings') {
      settingsOpen = false;
      render();
    } else if (action === 'preview' && id) {
      expandedProfiles.has(id) ? expandedProfiles.delete(id) : expandedProfiles.add(id);
      persist();
      renderLibrary();
    } else if (action === 'toggleSkillGroup') {
      const groupId = target.dataset.groupId;
      if (!groupId) return;
      expandedSkillGroups.has(groupId) ? expandedSkillGroups.delete(groupId) : expandedSkillGroups.add(groupId);
      persist();
      renderLibrary();
    } else if (action === 'toggleAutoSync') {
      post('setAutoSync', { enabled: !state.autoSync });
    } else if (['installSkill', 'uninstallSkill', 'applyProfile'].includes(action) && id) {
      busy.add(id);
      renderLibrary();
      post(action, { id });
    } else if (action) {
      post(action, id ? { id } : {});
    }
  });

  app.addEventListener('input', (event) => {
    if (event.target.id === 'search-input') {
      query = event.target.value;
      renderLibrary();
    }
  });

  app.addEventListener('change', (event) => {
    if (event.target.id === 'workspace-select') post('selectWorkspace', { id: event.target.value });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'state') {
      state = message.state;
      busy.clear();
      render();
    } else if (message.type === 'busy') {
      message.value ? busy.add(message.id) : busy.delete(message.id);
      renderLibrary();
    } else if (message.type === 'notice') {
      showToast(message.message, message.tone);
    }
  });

  post('ready');
})();
