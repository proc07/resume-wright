/* ============================================================
   index.js — Dashboard 客户端逻辑
   ============================================================ */

let casesData = [];
let currentCase = null;
let logEventSource = null;
let currentStatusFilter = 'all';
let selectedCasePaths = new Set();
const caseLogs = {};
const collapsedFolders = new Set();

function getSafeCaseName(name) {
  return name.replace(/[/?<>\\:*|"]/g, '_');
}

// 初始化加载
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadCases();
  initTerminalResizer();
});

// ── 核心数据获取 ──

async function loadCases() {
  try {
    const res = await fetch('/api/cases');
    const data = await res.json();
    casesData = data.cases || [];
    // 默认不要全部选中
    updateFilterCountBadges();
    renderCaseList();
    updateCaseCount();
    
    // 恢复先前选中的 Case
    if (!currentCase) {
      const savedName = localStorage.getItem('selectedCaseName');
      if (savedName) {
        currentCase = casesData.find(c => c.name === savedName) || null;
      }
    }

    // 如果有当前选中的 Case，重新渲染详情
    if (currentCase) {
      const updated = casesData.find(c => c.name === currentCase.name);
      if (updated) {
        selectCase(updated);
      }
    }
  } catch (err) {
    console.error('加载用例失败:', err);
    document.getElementById('case-list').innerHTML = `<div class="empty-msg" style="color:var(--color-error)">加载失败，请检查后端服务是否启动。</div>`;
  }
}

function updateCaseCount() {
  document.getElementById('case-count').textContent = casesData.length;
}

function updateFilterCountBadges() {
  document.getElementById('pill-count-all').textContent = casesData.length;
  document.getElementById('pill-count-passed').textContent = casesData.filter(c => c.status === 'passed').length;
  document.getElementById('pill-count-failed').textContent = casesData.filter(c => c.status === 'failed').length;
  document.getElementById('pill-count-paused').textContent = casesData.filter(c => c.status === 'paused').length;
  document.getElementById('pill-count-never').textContent = casesData.filter(c => c.status === 'never_run' || c.status === 'running').length;
}

// ── 渲染用例列表 ──

function buildTree(cases) {
  const root = { name: 'Root', type: 'folder', path: 'cases', children: [] };

  for (const c of cases) {
    const relativePath = c.filePath.replace(/^cases\//, '');
    const parts = relativePath.split('/');
    
    let currentNode = root;
    let currentPath = 'cases';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath + '/' + part;
      const isLast = (i === parts.length - 1);

      if (isLast) {
        currentNode.children.push({
          name: c.name,
          type: 'case',
          path: c.filePath,
          caseData: c
        });
      } else {
        let folder = currentNode.children.find(child => child.type === 'folder' && child.name === part);
        if (!folder) {
          folder = {
            name: part,
            type: 'folder',
            path: currentPath,
            children: []
          };
          currentNode.children.push(folder);
        }
        currentNode = folder;
      }
    }
  }
  
  return root.children;
}

function sortTree(nodes) {
  nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  
  for (const node of nodes) {
    if (node.type === 'folder' && node.children) {
      sortTree(node.children);
    }
  }
}

function renderTreeNode(node, depth = 0) {
  const indent = depth * 12;
  
  if (node.type === 'case') {
    const c = node.caseData;
    const isActive = currentCase && currentCase.name === c.name ? 'active' : '';
    const progressText = `${c.completedCount}/${c.totalSteps} 步骤`;
    const fileName = c.filePath.split('/').pop() || c.filePath;
    const isChecked = selectedCasePaths.has(c.filePath) ? 'checked' : '';
    
    return `
      <div class="case-item ${isActive}" style="margin-left: ${indent}px;" onclick="selectCaseByName('${encodeURIComponent(c.name)}')">
        <div class="case-item-title">
          <div class="case-title-left">
            <input type="checkbox" class="case-select-checkbox" onclick="toggleCaseSelection(event, '${c.filePath}')" ${isChecked}>
            <span class="case-item-name-text" title="${c.name}">${c.name}</span>
          </div>
          <span class="status-dot ${c.status}"></span>
        </div>
        <div class="case-item-meta">
          <span class="case-meta-left">${progressText}</span>
          <span class="case-meta-right" title="${fileName}"><code>${fileName}</code></span>
        </div>
      </div>
    `;
  } else {
    const isCollapsed = collapsedFolders.has(node.path) ? 'collapsed' : '';
    const childrenHtml = node.children.map(child => renderTreeNode(child, depth + 1)).join('');
    
    return `
      <div class="folder-node ${isCollapsed}">
        <div class="folder-header" style="padding-left: ${indent}px" onclick="toggleFolderCollapse(event, '${node.path}')">
          <span class="folder-toggle-icon">▼</span>
          <input type="checkbox" class="folder-select-checkbox" data-folder-path="${node.path}" onclick="toggleFolderSelection(event, '${node.path}')">
          <span class="folder-icon">📁</span>
          <span class="folder-name-text" title="${node.name}">${node.name}</span>
        </div>
        <div class="folder-children">
          ${childrenHtml}
        </div>
      </div>
    `;
  }
}

function toggleFolderCollapse(event, folderPath) {
  event.stopPropagation();
  const folderHeader = event.currentTarget;
  const folderEl = folderHeader.closest('.folder-node');
  if (folderEl) {
    folderEl.classList.toggle('collapsed');
    if (folderEl.classList.contains('collapsed')) {
      collapsedFolders.add(folderPath);
    } else {
      collapsedFolders.delete(folderPath);
    }
  }
}

function toggleFolderSelection(event, folderPath) {
  event.stopPropagation();
  const checkbox = event.target;
  const isChecked = checkbox.checked;
  
  const prefix = folderPath + '/';
  casesData.forEach(c => {
    if (c.filePath.startsWith(prefix)) {
      if (isChecked) {
        selectedCasePaths.add(c.filePath);
      } else {
        selectedCasePaths.delete(c.filePath);
      }
    }
  });

  renderCaseList();
}

function updateFolderCheckboxesIndeterminateState() {
  const checkboxes = document.querySelectorAll('.folder-select-checkbox');
  checkboxes.forEach(cb => {
    const folderPath = cb.getAttribute('data-folder-path');
    const prefix = folderPath + '/';
    const descendants = casesData.filter(c => c.filePath.startsWith(prefix));
    const checkedCount = descendants.filter(c => selectedCasePaths.has(c.filePath)).length;

    if (checkedCount > 0 && checkedCount < descendants.length) {
      cb.checked = false;
      cb.indeterminate = true;
    } else if (checkedCount === descendants.length && descendants.length > 0) {
      cb.checked = true;
      cb.indeterminate = false;
    } else {
      cb.checked = false;
      cb.indeterminate = false;
    }
  });
}

function renderCaseList() {
  const container = document.getElementById('case-list');
  const filterVal = document.getElementById('case-search-input').value.toLowerCase().trim();

  let filtered = casesData;

  // 1. 过滤状态
  if (currentStatusFilter !== 'all') {
    if (currentStatusFilter === 'never_run') {
      filtered = filtered.filter(c => c.status === 'never_run' || c.status === 'running');
    } else {
      filtered = filtered.filter(c => c.status === currentStatusFilter);
    }
  }

  // 2. 过滤检索词
  if (filterVal) {
    filtered = filtered.filter(c => c.name.toLowerCase().includes(filterVal) || c.filePath.toLowerCase().includes(filterVal));
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-msg">未找到匹配的用例</div>`;
    return;
  }

  const tree = buildTree(filtered);
  sortTree(tree);
  container.innerHTML = tree.map(node => renderTreeNode(node, 0)).join('');
  updateFolderCheckboxesIndeterminateState();
  updateSelectAllState();
}

function toggleCaseSelection(event, filePath) {
  event.stopPropagation();
  const checkbox = event.target;
  if (checkbox.checked) {
    selectedCasePaths.add(filePath);
  } else {
    selectedCasePaths.delete(filePath);
  }
  renderCaseList();
  updateSelectAllState();
}

function toggleSelectAll(event) {
  event.stopPropagation();
  const checkbox = event.target;
  if (checkbox.checked) {
    casesData.forEach(c => selectedCasePaths.add(c.filePath));
  } else {
    selectedCasePaths.clear();
  }
  renderCaseList();
  updateSelectAllState();
}

function updateSelectAllState() {
  const selectAllCheckbox = document.getElementById('select-all-checkbox');
  if (selectAllCheckbox) {
    const allChecked = casesData.length > 0 && casesData.every(c => selectedCasePaths.has(c.filePath));
    selectAllCheckbox.checked = allChecked;
  }
}

function filterCases() {
  renderCaseList();
}

function filterByStatus(status) {
  currentStatusFilter = status;
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.classList.remove('active');
  });
  event.currentTarget.classList.add('active');
  renderCaseList();
}

function selectCaseByName(encodedName) {
  const caseName = decodeURIComponent(encodedName);
  const c = casesData.find(item => item.name === caseName);
  if (c) {
    selectCase(c);
  }
}

// ── 渲染单例详情 ──

async function selectCase(c) {
  currentCase = c;
  localStorage.setItem('selectedCaseName', c.name);
  
  // 更新高亮样式
  renderCaseList();

  // 隐藏欢迎，显示详情
  document.getElementById('welcome-view').classList.add('hidden');
  document.getElementById('details-view').classList.remove('hidden');

  // 填充基本信息
  document.getElementById('detail-case-name').textContent = c.name;
  document.getElementById('detail-case-desc').textContent = c.description || '无用例描述';
  document.getElementById('detail-case-path').textContent = c.filePath;

  const badge = document.getElementById('detail-status-badge');
  badge.textContent = statusLabel(c.status);
  badge.className = `badge ${c.status}`;

  // 控制按钮状态
  updateButtonStates(c.status);

  // 渲染步骤列表
  renderSteps(c);

  // 默认切换到实时输出，并且更新内容
  switchTerminalTab('stream');
  updateStreamTerminalForSelectedCase();

  // 异步获取运行历史详情 (截图/子步骤/录像)
  try {
    const res = await fetch(`/api/case/${encodeURIComponent(c.name)}/details`);
    const details = await res.json();
    currentScreenshotsList = details.screenshots || [];
    renderTraces(c.name, details.traces || []);
    // 保存 sub-steps 状态用于点击步骤展开
    c.subStepsDetail = details.subSteps || {};
    c.traces = details.traces || [];
    renderSteps(c);
    
    // 默认展示当前未完成的或第一个步骤的子步骤详情
    const firstActiveStep = c.steps.find(s => !s.completed) || c.steps[0];
    if (firstActiveStep) {
      showSubSteps(firstActiveStep.id);
    }
  } catch (err) {
    console.error('获取用例详情失败:', err);
  }

  // 加载运行历史
  loadRunHistory();
}

function updateButtonStates(status) {
  const btnRun = document.getElementById('btn-run-case');
  const btnRestart = document.getElementById('btn-restart-case');
  const btnReset = document.getElementById('btn-reset-case');
  const btnStop = document.getElementById('btn-stop-case');

  if (status === 'running') {
    btnRun.disabled = true;
    btnRestart.disabled = true;
    btnReset.disabled = true;
    btnStop.classList.remove('hidden');
  } else {
    btnRun.disabled = false;
    btnRestart.disabled = false;
    btnReset.disabled = false;
    btnStop.classList.add('hidden');

    if (status === 'passed') {
      btnRun.textContent = '▶ 重新执行';
    } else if (status === 'paused' || status === 'failed') {
      btnRun.textContent = '▶ 继续执行';
    } else {
      btnRun.textContent = '▶ 开始执行';
    }
  }
}

// ── 渲染用例步骤列表 ──

function renderSteps(c) {
  const container = document.getElementById('steps-timeline');
  container.innerHTML = c.steps.map((s, index) => {
    let stepClass = 'step-node';
    const detail = c.subStepsDetail?.[s.id];
    const hasFailedSubStep = detail && Object.values(detail).some(sub => sub.status === 'failed');
    const isFailedStep = hasFailedSubStep || (c.status === 'failed' && c.completedCount === index);

    if (isFailedStep) {
      stepClass += ' failed';
    } else if (s.completed) {
      stepClass += ' completed';
    } else if (c.status === 'running' && c.completedCount === index) {
      stepClass += ' running';
    }

    const hasTrace = c.traces && c.traces.includes(`${s.id}-trace.zip`);
    const playButtonHtml = (s.completed && hasTrace) 
      ? `<button class="btn-step-play-trace" onclick="playStepTrace(event, '${encodeURIComponent(c.name)}', '${encodeURIComponent(s.id + '-trace.zip')}')" title="播放该步骤录像">🎞</button>`
      : '';

    return `
      <div class="${stepClass}" id="step-node-${s.id}" onclick="showSubSteps('${s.id}')">
        <div class="step-indicator">
          ${isFailedStep ? '✗' : (s.completed ? '✓' : index + 1)}
        </div>
        <div class="step-info">
          <div class="step-header-row">
            <div class="step-id">${s.id}</div>
            ${playButtonHtml}
          </div>
          <div class="step-role">角色: ${s.role}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ── 展示 SubSteps 详细缓存与快照 ──

async function showSubSteps(stepId) {
  // 设置选中高亮
  document.querySelectorAll('.step-node').forEach(el => el.classList.remove('active-step'));
  const activeEl = document.getElementById(`step-node-${stepId}`);
  if (activeEl) activeEl.classList.add('active-step');

  const panel = document.getElementById('substeps-panel');
  if (!currentCase) return;

  // 尝试获取最新的详情以更新截图和子步骤缓存，保持界面实时更新
  try {
    const res = await fetch(`/api/case/${encodeURIComponent(currentCase.name)}/details`);
    const details = await res.json();
    currentScreenshotsList = details.screenshots || [];
    currentCase.subStepsDetail = details.subSteps || {};
    currentCase.traces = details.traces || [];
  } catch (err) {
    console.error('更新步骤详情失败:', err);
  }

  const step = currentCase.steps.find(s => s.id === stepId);
  const detail = currentCase.subStepsDetail?.[stepId];

  if (!step) return;

  let html = '';

  if (step.subStepsCount === 0) {
    // 该 Step 无 sub_steps，可能只有 script
    html = `
      <div class="substep-card">
        <div class="substep-header">
          <span class="substep-title">主步骤脚本执行</span>
          <span class="substep-status ${step.completed ? 'completed' : 'pending'}">${step.completed ? '已完成' : '未运行'}</span>
        </div>
      </div>
    `;
  } else if (!detail || Object.keys(detail).length === 0) {
    html = `
      <p class="empty-msg">该步骤包含 ${step.subStepsCount} 个子步骤，但目前尚无历史执行记录。</p>
    `;
  } else {
    // 渲染子步骤卡片列表
    html = Object.entries(detail).map(([subId, state]) => {
      const statusClass = state.status;
      const cacheFile = state.apiCache || [];

      return `
        <div class="substep-card">
          <div class="substep-header">
            <span class="substep-title">子步骤: <code>${subId}</code></span>
            <span class="substep-status ${statusClass}">${statusLabel(state.status)}</span>
          </div>
          ${state.retryCount ? `<div style="font-size:11px;color:var(--color-warning)">重试次数: ${state.retryCount}</div>` : ''}
          ${state.error ? `<div style="font-size:12px;color:var(--color-error);word-break:break-all">${state.error}</div>` : ''}
          
          <!-- API 响应缓存列表 -->
          <div class="api-cache-list mt-2">
            <div class="api-cache-title">接口缓存命中 (API Response Cache)</div>
            ${cacheFile.length === 0 ? '<div style="font-size:11px;color:#cbd5e1">暂无 API 缓存</div>' : 
              cacheFile.map(c => `
                <div class="api-cache-item">
                  <div>
                    <span class="api-cache-method">${c.method}</span>
                    <span class="api-cache-url" title="${c.url}">${c.url}</span>
                  </div>
                  <span class="api-cache-badge">${c.status}</span>
                </div>
              `).join('')
            }
          </div>
        </div>
      `;
    }).join('');
  }

  // 过滤属于该步骤的截图 (根据文件名 startsWith stepId + '-'，或包含 '-' + stepId + '-'，或以 '-' + stepId + '.png' 结尾)
  const stepScreenshots = (currentScreenshotsList || []).filter(src => {
    const parts = src.split('/');
    const filename = decodeURIComponent(parts[parts.length - 1]);
    return filename.startsWith(stepId + '-') || filename.includes('-' + stepId + '-') || filename.endsWith('-' + stepId + '.png');
  });

  if (stepScreenshots.length > 0) {
    html += `
      <div class="step-screenshots-section mt-4">
        <div class="api-cache-title" style="margin-bottom: 8px;">📸 步骤运行快照 (${stepScreenshots.length})</div>
        <div class="screenshots-gallery">
          ${stepScreenshots.map(src => {
            const origIndex = currentScreenshotsList.indexOf(src);
            const parts = src.split('/');
            const name = decodeURIComponent(parts[parts.length - 1]);
            return `
              <div class="screenshot-card" onclick="openLightbox(${origIndex})">
                <img src="${src}" alt="Snapshot" loading="lazy">
                <div class="screenshot-name" title="${name}">${name}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  panel.innerHTML = html;
}

// ── 截图相册状态 ──

let currentScreenshotsList = [];
let currentLightboxIndex = -1;

// ── 用例执行逻辑 (Server-Sent Events) ──

async function runCurrentCase(fromStart = false) {
  if (!currentCase) return;

  if (fromStart) {
    // 重新跑，先清断点
    await resetCurrentCase(true);
  }

  const headed = document.getElementById('opt-headed').checked;
  const trace = document.getElementById('opt-trace').checked;
  const screenshotOnAssert = document.getElementById('opt-screenshot-on-assert').checked;
  const path = currentCase.filePath;

  // 状态改为 running
  currentCase.status = 'running';
  selectCase(currentCase);

  // 清空终端
  const safeName = getSafeCaseName(currentCase.name);
  caseLogs[safeName] = '';
  updateStreamTerminalForSelectedCase();

  // 创建 EventSource
  const url = `/api/run-stream?cases=${encodeURIComponent(path)}&headed=${headed}&trace=${trace}&screenshotOnAssert=${screenshotOnAssert}`;
  if (logEventSource) {
    logEventSource.close();
  }

  logEventSource = new EventSource(url);

  logEventSource.addEventListener('log', (e) => {
    const data = JSON.parse(e.data);
    const text = data.text;
    const cleanedText = text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

    if (data.case) {
      const safeCase = data.case;
      if (!caseLogs[safeCase]) caseLogs[safeCase] = '';
      caseLogs[safeCase] += cleanedText;
      
      if (currentCase && getSafeCaseName(currentCase.name) === safeCase) {
        appendTerminal(cleanedText);
      }
    } else {
      const runningCases = casesData.filter(c => c.status === 'running');
      if (runningCases.length > 0) {
        runningCases.forEach(c => {
          const safeCase = getSafeCaseName(c.name);
          if (!caseLogs[safeCase]) caseLogs[safeCase] = '';
          caseLogs[safeCase] += cleanedText;
        });
      } else if (currentCase) {
        const safeCase = getSafeCaseName(currentCase.name);
        if (!caseLogs[safeCase]) caseLogs[safeCase] = '';
        caseLogs[safeCase] += cleanedText;
      }
      if (currentCase) {
        appendTerminal(cleanedText);
      }
    }
  });

  logEventSource.addEventListener('finish', (e) => {
    const data = JSON.parse(e.data);
    const finishText = `\n\n[system] Process exited with code: ${data.exitCode}\n`;
    
    const runningCases = casesData.filter(c => c.status === 'running');
    runningCases.forEach(c => {
      const safeCase = getSafeCaseName(c.name);
      if (!caseLogs[safeCase]) caseLogs[safeCase] = '';
      caseLogs[safeCase] += finishText;
    });
    if (currentCase) {
      const currentSafe = getSafeCaseName(currentCase.name);
      const isRunning = runningCases.some(c => getSafeCaseName(c.name) === currentSafe);
      if (!isRunning) {
        if (!caseLogs[currentSafe]) caseLogs[currentSafe] = '';
        caseLogs[currentSafe] += finishText;
      }
      appendTerminal(finishText);
    }

    logEventSource.close();
    logEventSource = null;
    loadCases(); // 重新加载列表更新状态
    loadRunHistory(); // 刷新运行历史
  });

  logEventSource.onerror = (err) => {
    const errorText = `\n\n[system] EventSource 遇到错误连接断开。\n`;
    if (currentCase) {
      const safeCase = getSafeCaseName(currentCase.name);
      if (!caseLogs[safeCase]) caseLogs[safeCase] = '';
      caseLogs[safeCase] += errorText;
      appendTerminal(errorText);
    }
    logEventSource.close();
    logEventSource = null;
    loadCases();
    loadRunHistory();
  };
}

async function runAllSelected() {
  // 运行勾选的用例
  const files = Array.from(selectedCasePaths);
  if (files.length === 0) {
    alert('请先勾选需要运行的测试用例！');
    return;
  }

  const headed = document.getElementById('opt-headed').checked;
  const trace = document.getElementById('opt-trace').checked;
  const screenshotOnAssert = document.getElementById('opt-screenshot-on-assert').checked;

  // 状态修改为 running
  casesData.forEach(c => {
    if (selectedCasePaths.has(c.filePath)) {
      c.status = 'running';
    }
  });
  renderCaseList();

  // 如果选中了具体详情页，且在勾选的用例中，重置详情状态为 running
  if (currentCase && selectedCasePaths.has(currentCase.filePath)) {
    currentCase.status = 'running';
    selectCase(currentCase);
  }

  // 清空选中运行用例的终端日志
  files.forEach(filePath => {
    const c = casesData.find(item => item.filePath === filePath);
    if (c) {
      caseLogs[getSafeCaseName(c.name)] = '';
    }
  });
  updateStreamTerminalForSelectedCase();

  const url = `/api/run-stream?cases=${encodeURIComponent(files.join(','))}&headed=${headed}&trace=${trace}&screenshotOnAssert=${screenshotOnAssert}`;
  if (logEventSource) {
    logEventSource.close();
  }

  logEventSource = new EventSource(url);

  logEventSource.addEventListener('log', (e) => {
    const data = JSON.parse(e.data);
    const text = data.text;
    const cleanedText = text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

    if (data.case) {
      const safeCase = data.case;
      if (!caseLogs[safeCase]) caseLogs[safeCase] = '';
      caseLogs[safeCase] += cleanedText;
      
      if (currentCase && getSafeCaseName(currentCase.name) === safeCase) {
        appendTerminal(cleanedText);
      }
    } else {
      const runningCases = casesData.filter(c => c.status === 'running');
      if (runningCases.length > 0) {
        runningCases.forEach(c => {
          const safeCase = getSafeCaseName(c.name);
          if (!caseLogs[safeCase]) caseLogs[safeCase] = '';
          caseLogs[safeCase] += cleanedText;
        });
      } else if (currentCase) {
        const safeCase = getSafeCaseName(c.name);
        if (!caseLogs[safeCase]) caseLogs[safeCase] = '';
        caseLogs[safeCase] += cleanedText;
      }
      if (currentCase) {
        appendTerminal(cleanedText);
      }
    }
  });

  logEventSource.addEventListener('finish', (e) => {
    const data = JSON.parse(e.data);
    const finishText = `\n\n[system] All cases completed. Exit code: ${data.exitCode}\n`;
    
    const runningCases = casesData.filter(c => c.status === 'running');
    runningCases.forEach(c => {
      const safeCase = getSafeCaseName(c.name);
      if (!caseLogs[safeCase]) caseLogs[safeCase] = '';
      caseLogs[safeCase] += finishText;
    });
    if (currentCase) {
      const currentSafe = getSafeCaseName(currentCase.name);
      const isRunning = runningCases.some(c => getSafeCaseName(c.name) === currentSafe);
      if (!isRunning) {
        if (!caseLogs[currentSafe]) caseLogs[currentSafe] = '';
        caseLogs[currentSafe] += finishText;
      }
      appendTerminal(finishText);
    }

    logEventSource.close();
    logEventSource = null;
    loadCases();
    loadRunHistory();
  });

  logEventSource.onerror = () => {
    const errorText = `\n\n[system] EventSource 遇到错误连接断开。\n`;
    if (currentCase) {
      const safeCase = getSafeCaseName(currentCase.name);
      if (!caseLogs[safeCase]) caseLogs[safeCase] = '';
      caseLogs[safeCase] += errorText;
      appendTerminal(errorText);
    }
    logEventSource.close();
    logEventSource = null;
    loadCases();
    loadRunHistory();
  };
}

async function stopExecution() {
  try {
    const res = await fetch('/api/stop', { method: 'POST' });
    const data = await res.json();
    appendTerminal(`\n[system] Stop signal sent: ${data.message}\n`);
  } catch (err) {
    console.error('停止进程失败:', err);
  }
}

async function resetCurrentCase(silent = false) {
  if (!currentCase) return;
  if (!silent && !confirm(`确认要重置用例 "${currentCase.name}" 的断点数据吗？重置后将清除全部已完成的步骤记录，下次执行时会从第 1 步重新开始。`)) {
    return;
  }

  try {
    const res = await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseName: currentCase.name })
    });
    const data = await res.json();
    if (data.success) {
      if (!silent) {
        appendTerminal(`\n[system] Checkpoint and snapshots for "${currentCase.name}" cleared.\n`);
        loadCases();
      }
    }
  } catch (err) {
    console.error('重置断点失败:', err);
  }
}

async function resetAll() {
  if (!confirm('警告：确认要重置全部用例的断点数据吗？此操作会物理清除所有 Checkpoint 存档文件。')) {
    return;
  }

  try {
    const res = await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true })
    });
    const data = await res.json();
    if (data.success) {
      appendTerminal(`\n[system] All checkpoints cleared.\n`);
      loadCases();
    }
  } catch (err) {
    console.error('重置所有断点失败:', err);
  }
}

// ── 终端控制 ──

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function colorizeLogs(text) {
  const escaped = escapeHtml(text);
  const lines = escaped.split('\n');
  const coloredLines = lines.map(line => {
    // 1. [dsl] commands
    if (line.includes('[dsl]')) {
      const dslMatch = line.match(/^(\[dsl\]\s+)(\??\s*)([a-zA-Z0-9_]+)(\s+.*)?$/);
      if (dslMatch) {
        const prefix = dslMatch[1];
        const optional = dslMatch[2];
        const cmd = dslMatch[3];
        const rest = dslMatch[4] || '';
        
        let cmdColor = 'var(--text-primary)';
        if (cmd === 'open') cmdColor = '#38bdf8'; // light blue
        else if (cmd === 'input') cmdColor = '#f59e0b'; // amber/orange
        else if (cmd === 'tap') cmdColor = '#10b981'; // emerald green
        else if (cmd.startsWith('assert_')) cmdColor = '#c084fc'; // purple/violet
        else if (cmd === 'screenshot') cmdColor = '#f472b6'; // pink
        else if (cmd === 'wait') cmdColor = '#94a3b8'; // slate gray
        else if (cmd === 'check' || cmd === 'upload') cmdColor = '#818cf8'; // indigo
        else if (cmd.startsWith('do_')) cmdColor = '#f43f5e'; // rose
        else if (cmd === 'macro') cmdColor = '#fb923c'; // orange
        else if (cmd === 'keyboard' || cmd === 'hover' || cmd === 'scroll_to') cmdColor = '#2dd4bf'; // teal
        else if (cmd === 'execute_script') cmdColor = '#eab308'; // yellow
        
        const optHtml = optional ? `<span style="color:#ef4444">${optional}</span>` : '';
        return `<span style="color:#64748b">${prefix}</span>${optHtml}<span style="color:${cmdColor};font-weight:bold">${cmd}</span>${rest}`;
      }

      // Variable assignments
      const assignMatch = line.match(/^(\[dsl\]\s+)(\s*)(\$[a-zA-Z0-9_]+)(\s*=\s*)(.*)$/);
      if (assignMatch) {
        const prefix = assignMatch[1];
        const spaces = assignMatch[2];
        const varName = assignMatch[3];
        const equalSign = assignMatch[4];
        const val = assignMatch[5];
        return `<span style="color:#64748b">${prefix}</span>${spaces}<span style="color:#2dd4bf">${varName}</span><span style="color:#94a3b8">${equalSign}</span><span style="color:#cbd5e1">${val}</span>`;
      }
    }

    // 2. [step] logs
    if (line.includes('[step]')) {
      if (line.includes('✓ Step completed')) {
        return `<span style="color:#10b981;font-weight:bold">${line}</span>`;
      }
      if (line.includes('✗ Step failed') || line.includes('failed after')) {
        return `<span style="color:#ef4444;font-weight:bold">${line}</span>`;
      }
      return `<span style="color:#38bdf8">${line}</span>`;
    }

    // 3. [runner] logs
    if (line.includes('[runner]')) {
      if (line.includes('✅ Case PASSED')) {
        return `<span style="color:#10b981;font-weight:bold;font-size:13px">${line}</span>`;
      }
      if (line.includes('❌ Case FAILED')) {
        return `<span style="color:#ef4444;font-weight:bold;font-size:13px">${line}</span>`;
      }
      return `<span style="color:#c084fc">${line}</span>`;
    }

    // 4. [network-interceptor] logs
    if (line.includes('[network-interceptor]')) {
      return `<span style="color:#64748b">${line}</span>`;
    }

    // 5. [checkpoint] logs
    if (line.includes('[checkpoint]')) {
      return `<span style="color:#f59e0b">${line}</span>`;
    }

    // 6. [role-pool] logs
    if (line.includes('[role-pool]')) {
      return `<span style="color:#eab308">${line}</span>`;
    }

    // 7. [system] logs
    if (line.includes('[system]')) {
      return `<span style="color:#94a3b8;font-style:italic">${line}</span>`;
    }

    return line;
  });
  return coloredLines.join('\n');
}

function appendTerminal(text) {
  const terminal = document.getElementById('terminal-body');
  if (!terminal || !currentCase) return;
  const safeName = getSafeCaseName(currentCase.name);
  terminal.innerHTML = colorizeLogs(caseLogs[safeName] || '');
  terminal.scrollTop = terminal.scrollHeight;
}

function clearTerminal() {
  const terminal = document.getElementById('terminal-body');
  if (terminal) terminal.innerHTML = '';
  if (currentCase) {
    const safeName = getSafeCaseName(currentCase.name);
    caseLogs[safeName] = '';
  }
}

function updateStreamTerminalForSelectedCase() {
  const terminal = document.getElementById('terminal-body');
  if (!terminal || !currentCase) return;
  const safeName = getSafeCaseName(currentCase.name);
  const logs = caseLogs[safeName] || '';
  terminal.innerHTML = colorizeLogs(logs);
  terminal.scrollTop = terminal.scrollHeight;
}

function switchTerminalTab(tab) {
  const btnStream = document.getElementById('tab-btn-stream');
  const btnHistory = document.getElementById('tab-btn-history');
  const paneStream = document.getElementById('pane-stream');
  const paneHistory = document.getElementById('pane-history');
  const btnClear = document.getElementById('btn-clear-terminal');

  if (tab === 'stream') {
    btnStream.classList.add('active');
    btnHistory.classList.remove('active');
    paneStream.classList.remove('hidden');
    paneHistory.classList.add('hidden');
    if (btnClear) btnClear.classList.remove('hidden');
  } else {
    btnStream.classList.remove('active');
    btnHistory.classList.add('active');
    paneStream.classList.add('hidden');
    paneHistory.classList.remove('hidden');
    if (btnClear) btnClear.classList.add('hidden');
    
    loadRunHistory();
  }
}

function formatFriendlyDateTime(isoString) {
  if (!isoString) return '--';
  try {
    const date = new Date(isoString);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  } catch {
    return isoString;
  }
}

let activeHistoryRunId = null;

async function loadRunHistory() {
  const sidebar = document.getElementById('history-sidebar');
  if (!sidebar || !currentCase) return;

  try {
    const res = await fetch(`/api/case/${encodeURIComponent(currentCase.name)}/history`);
    const history = await res.json();
    
    if (!history || history.length === 0) {
      sidebar.innerHTML = '<div class="empty-msg">暂无运行历史</div>';
      document.getElementById('history-log-body').innerHTML = '选择左侧运行记录以查看日志...';
      activeHistoryRunId = null;
      return;
    }

    sidebar.innerHTML = history.map(run => {
      const isActive = activeHistoryRunId === run.runId ? 'active' : '';
      let statusText = '未知';
      if (run.status === 'passed') statusText = '通过';
      else if (run.status === 'failed') statusText = '失败';
      else if (run.status === 'running') statusText = '运行中';

      const durationText = run.duration ? `${(run.duration / 1000).toFixed(1)}s` : '--';

      return `
        <div class="history-run-item ${isActive}" data-run-id="${run.runId}" onclick="selectHistoryRun('${run.runId}')">
          <div class="run-header">
            <span class="run-status-badge ${run.status}">${statusText}</span>
            <span class="run-time">${formatFriendlyDateTime(run.timestamp)}</span>
          </div>
          <div class="run-meta">
            <span>耗时: ${durationText}</span>
            ${run.error ? `<span class="run-error-indicator" title="${run.error}">⚠️ 异常</span>` : ''}
          </div>
        </div>
      `;
    }).join('');

    if (activeHistoryRunId && history.some(r => r.runId === activeHistoryRunId)) {
      selectHistoryRun(activeHistoryRunId);
    } else {
      selectHistoryRun(history[0].runId);
    }
  } catch (err) {
    console.error('加载运行历史失败:', err);
    sidebar.innerHTML = '<div class="empty-msg" style="color:var(--color-error)">加载失败</div>';
  }
}

async function selectHistoryRun(runId) {
  activeHistoryRunId = runId;
  
  document.querySelectorAll('.history-run-item').forEach(el => {
    if (el.getAttribute('data-run-id') === runId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  const logBody = document.getElementById('history-log-body');
  if (!logBody || !currentCase) return;

  logBody.textContent = '加载日志中...';

  try {
    const res = await fetch(`/api/case/${encodeURIComponent(currentCase.name)}/history/${runId}/log`);
    if (res.status === 404) {
      logBody.textContent = '日志文件已被清理或不存在。';
      return;
    }
    const text = await res.text();
    const cleanedText = text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
    logBody.innerHTML = colorizeLogs(cleanedText);
    logBody.scrollTop = 0;
  } catch (err) {
    console.error('获取运行日志失败:', err);
    logBody.textContent = '加载运行日志失败。';
  }
}

// ── 辅助映射 ──

function statusLabel(s) {
  return {
    passed: '执行通过',
    failed: '执行失败',
    paused: '断点暂停',
    never_run: '未运行',
    running: '正在执行...'
  }[s] || s;
}

// ── 运行录像渲染与播放 ──

function renderTraces(caseName, traces) {
  const container = document.getElementById('trace-buttons-container');
  if (container) {
    container.innerHTML = '';
  }
}

function playStepTrace(event, caseName, file) {
  event.stopPropagation();
  playTrace(caseName, file);
}

async function playTrace(encodedCaseName, encodedTraceFile) {
  const caseName = decodeURIComponent(encodedCaseName);
  const traceFile = decodeURIComponent(encodedTraceFile);

  try {
    const res = await fetch('/api/play-trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseName, traceFile })
    });
    const data = await res.json();
    if (!data.success) {
      alert(`无法播放录像: ${data.error || data.message}`);
    }
  } catch (err) {
    console.error('播放录像失败:', err);
    alert('请求出错，请确保后端服务正常运行。');
  }
}

// ── 设置弹窗交互 ──

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    if (settings) {
      const optHeaded = document.getElementById('opt-headed');
      const optTrace = document.getElementById('opt-trace');
      const optAssert = document.getElementById('opt-screenshot-on-assert');
      if (optHeaded) optHeaded.checked = !!settings.headed;
      if (optTrace) optTrace.checked = !!settings.trace;
      if (optAssert) optAssert.checked = !!settings.screenshotOnAssert;
    }
  } catch (err) {
    console.error('加载设置失败:', err);
  }
}

async function saveSettings() {
  const optHeaded = document.getElementById('opt-headed');
  const optTrace = document.getElementById('opt-trace');
  const optAssert = document.getElementById('opt-screenshot-on-assert');
  
  const headed = optHeaded ? optHeaded.checked : true;
  const trace = optTrace ? optTrace.checked : true;
  const screenshotOnAssert = optAssert ? optAssert.checked : false;

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headed, trace, screenshotOnAssert })
    });
  } catch (err) {
    console.error('保存设置失败:', err);
  }
}

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('hidden');
  saveSettings();
}

function closeSettingsModalOnOutsideClick(event) {
  const modalContent = document.querySelector('#settings-modal .modal-content');
  if (modalContent && !modalContent.contains(event.target)) {
    closeSettingsModal();
  }
}

// ── 幻灯片大图预览 (Lightbox) ──

function openLightbox(index) {
  if (index < 0 || index >= currentScreenshotsList.length) return;
  currentLightboxIndex = index;
  
  const modal = document.getElementById('lightbox-modal');
  const img = document.getElementById('lightbox-img');
  const caption = document.getElementById('lightbox-caption');
  
  const src = currentScreenshotsList[index];
  const parts = src.split('/');
  const name = decodeURIComponent(parts[parts.length - 1]);
  
  img.src = src;
  caption.textContent = name;
  
  modal.classList.remove('hidden');
  
  // 监听键盘按键
  document.addEventListener('keydown', handleLightboxKeydown);
}

function closeLightbox() {
  const modal = document.getElementById('lightbox-modal');
  modal.classList.add('hidden');
  document.removeEventListener('keydown', handleLightboxKeydown);
}

function closeLightboxOnOutsideClick(event) {
  const img = document.getElementById('lightbox-img');
  const prevBtn = document.querySelector('.prev-btn');
  const nextBtn = document.querySelector('.next-btn');
  if (event.target !== img && event.target !== prevBtn && event.target !== nextBtn) {
    closeLightbox();
  }
}

function navigateLightbox(direction) {
  if (currentScreenshotsList.length <= 1) return;
  
  let newIndex = currentLightboxIndex + direction;
  if (newIndex < 0) {
    newIndex = currentScreenshotsList.length - 1; // 环绕回末尾
  } else if (newIndex >= currentScreenshotsList.length) {
    newIndex = 0; // 环绕回到开头
  }
  
  openLightbox(newIndex);
}

function handleLightboxKeydown(e) {
  if (e.key === 'ArrowRight') {
    navigateLightbox(1);
  } else if (e.key === 'ArrowLeft') {
    navigateLightbox(-1);
  } else if (e.key === 'Escape') {
    closeLightbox();
  }
}

// ── 终端上下拖动调整大小 ───────────────────────────────────────
function initTerminalResizer() {
  const resizer = document.getElementById('terminal-resizer');
  const container = document.getElementById('terminal-container');
  if (!resizer || !container) return;

  // 加载用户首选高度
  const savedHeight = localStorage.getItem('terminalHeightPreference');
  if (savedHeight) {
    container.style.height = `${savedHeight}px`;
  }

  let startY = 0;
  let startHeight = 0;

  function onMouseDown(e) {
    startY = e.clientY;
    startHeight = parseInt(document.defaultView.getComputedStyle(container).height, 10);
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    resizer.classList.add('dragging');
    document.body.style.userSelect = 'none';
  }

  function onMouseMove(e) {
    const deltaY = startY - e.clientY; // 往上拖动 deltaY 为正
    let newHeight = startHeight + deltaY;

    // 限制高度范围
    const minHeight = 100;
    const maxHeight = window.innerHeight * 0.85;
    if (newHeight < minHeight) newHeight = minHeight;
    if (newHeight > maxHeight) newHeight = maxHeight;

    container.style.height = `${newHeight}px`;
    localStorage.setItem('terminalHeightPreference', newHeight);
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    resizer.classList.remove('dragging');
    document.body.style.userSelect = '';
  }

  resizer.addEventListener('mousedown', onMouseDown);
}
