document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const chatForm = document.getElementById('chat-form');
  const userInput = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  const chatContainer = document.getElementById('chat-container');
  const welcomeView = document.getElementById('welcome-view');
  const typingIndicator = document.getElementById('typing-indicator');
  const typingText = document.getElementById('typing-text');
  const toolsList = document.getElementById('tools-list');
  const clearBtn = document.getElementById('clear-btn');
  const agentStatusText = document.getElementById('agent-status-text');
  const statusDot = document.getElementById('status-dot');
  const modelSelect = document.getElementById('model-select');
  const headerModelName = document.getElementById('header-model-name');
  const toastContainer = document.getElementById('toast-container');
  
  // Settings Modal Elements
  const settingsModal = document.getElementById('settings-modal');
  const openSettingsBtn = document.getElementById('open-settings-btn');
  const settingsTopBtn = document.getElementById('settings-top-btn');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const cancelModalBtn = document.getElementById('cancel-modal-btn');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const apiKeyInput = document.getElementById('api-key-input');
  const toggleKeyVisibility = document.getElementById('toggle-key-visibility');
  const modalModelSelect = document.getElementById('modal-model-select');

  // State
  let currentModel = localStorage.getItem('mcp_selected_model') || 'gemini-2.5-flash';
  let customApiKey = localStorage.getItem('mcp_custom_api_key') || '';
  let activeCountdownInterval = null;

  // Initialize UI State
  init();

  async function init() {
    // Sync model selectors
    if (modelSelect) modelSelect.value = currentModel;
    if (modalModelSelect) modalModelSelect.value = currentModel;
    if (apiKeyInput) apiKeyInput.value = customApiKey;
    updateHeaderModelBadge(currentModel);

    // Bind event listeners
    bindEvents();

    // Fetch tools & status from server
    await fetchAgentStatus();
  }

  function bindEvents() {
    // Model Select change in sidebar
    modelSelect.addEventListener('change', (e) => {
      setSelectedModel(e.target.value);
      showToast(`Active model changed to ${e.target.options[e.target.selectedIndex].text}`, 'info');
    });

    // Modal Model Select change
    modalModelSelect.addEventListener('change', (e) => {
      setSelectedModel(e.target.value);
    });

    // Clear chat
    clearBtn.addEventListener('click', () => {
      chatContainer.innerHTML = '';
      chatContainer.appendChild(welcomeView);
      welcomeView.classList.remove('hidden');
      showToast('Chat history cleared', 'info');
    });

    // Chat form submit
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const message = userInput.value.trim();
      if (!message) return;

      sendMessage(message);
      userInput.value = '';
    });

    // Settings Modal Open/Close
    const openModal = () => {
      settingsModal.classList.remove('hidden');
      if (apiKeyInput) apiKeyInput.value = customApiKey;
      if (modalModelSelect) modalModelSelect.value = currentModel;
    };

    const closeModal = () => {
      settingsModal.classList.add('hidden');
    };

    if (openSettingsBtn) openSettingsBtn.addEventListener('click', openModal);
    if (settingsTopBtn) settingsTopBtn.addEventListener('click', openModal);
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (cancelModalBtn) cancelModalBtn.addEventListener('click', closeModal);

    // Save Settings
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', async () => {
        const newKey = apiKeyInput.value.trim();
        const newModel = modalModelSelect.value;

        setSelectedModel(newModel);
        
        if (newKey) {
          customApiKey = newKey;
          localStorage.setItem('mcp_custom_api_key', newKey);
          
          try {
            await fetch('/api/config/key', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ api_key: newKey })
            });
            showToast('Gemini API key updated successfully!', 'success');
          } catch (err) {
            showToast('Saved key locally.', 'info');
          }
        }
        
        closeModal();
      });
    }

    // Toggle API Key visibility
    if (toggleKeyVisibility && apiKeyInput) {
      toggleKeyVisibility.addEventListener('click', () => {
        const isPassword = apiKeyInput.type === 'password';
        apiKeyInput.type = isPassword ? 'text' : 'password';
        toggleKeyVisibility.innerHTML = isPassword 
          ? '<i class="fa-solid fa-eye-slash"></i>' 
          : '<i class="fa-solid fa-eye"></i>';
      });
    }
  }

  function setSelectedModel(modelId) {
    currentModel = modelId;
    localStorage.setItem('mcp_selected_model', modelId);
    if (modelSelect) modelSelect.value = modelId;
    if (modalModelSelect) modalModelSelect.value = modelId;
    updateHeaderModelBadge(modelId);
  }

  function updateHeaderModelBadge(modelId) {
    if (!headerModelName) return;
    const selectedOption = modelSelect.querySelector(`option[value="${modelId}"]`);
    headerModelName.textContent = selectedOption ? selectedOption.text.split(' (')[0] : modelId;
  }

  // Global suggestion helper
  window.sendSuggestion = function(text) {
    sendMessage(text);
  };

  async function fetchAgentStatus() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Status endpoint failed');
      const data = await res.json();
      
      renderTools(data.tools || []);
      if (agentStatusText) agentStatusText.textContent = 'Connected & Ready';
      if (statusDot) {
        statusDot.className = 'dot online';
      }
    } catch (err) {
      console.error('Error fetching agent status:', err);
      if (toolsList) toolsList.innerHTML = '<div class="tool-chip loading">Failed to load tools</div>';
      if (agentStatusText) agentStatusText.textContent = 'Disconnected';
      if (statusDot) {
        statusDot.className = 'dot offline';
      }
    }
  }

  function renderTools(tools) {
    if (!toolsList) return;
    if (!tools || tools.length === 0) {
      toolsList.innerHTML = '<div class="tool-chip loading">No registered tools found</div>';
      return;
    }

    toolsList.innerHTML = tools.map(tool => `
      <div class="tool-chip">
        <div class="tool-chip-header">
          <i class="fa-solid fa-bolt"></i> ${escapeHtml(tool.name)}
        </div>
        <div class="tool-chip-desc">${escapeHtml(tool.description)}</div>
      </div>
    `).join('');
  }

  async function sendMessage(messageText) {
    if (welcomeView && !welcomeView.classList.contains('hidden')) {
      welcomeView.classList.add('hidden');
    }

    appendUserMessage(messageText);

    // Set UI to loading
    setLoadingState(true);

    try {
      const payload = {
        message: messageText,
        model: currentModel
      };
      if (customApiKey) {
        payload.api_key = customApiKey;
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      setLoadingState(false);

      if (!response.ok) {
        const detail = data.detail || {};
        
        if (response.status === 429 || (typeof detail === 'object' && detail.error_type === 'rate_limit_exceeded')) {
          appendRateLimitMessage(detail, messageText);
          return;
        }

        const errorMsg = typeof detail === 'string' ? detail : (detail.message || JSON.stringify(detail));
        const rawErr = detail.raw_error || (typeof detail === 'object' ? JSON.stringify(detail, null, 2) : '');
        appendErrorMessage(errorMsg, rawErr, messageText);
        return;
      }

      appendAgentMessage(data.steps || [], data.reply || '', data.fallback_triggered, data.model_used);
    } catch (err) {
      setLoadingState(false);
      console.error('Error talking to Agent API:', err);
      appendErrorMessage('Network error: Could not reach the Agent server.', err.toString(), messageText);
    }
  }

  function setLoadingState(isLoading) {
    if (isLoading) {
      typingIndicator.classList.remove('hidden');
      sendBtn.disabled = true;
    } else {
      typingIndicator.classList.add('hidden');
      sendBtn.disabled = false;
    }
    scrollToBottom();
  }

  function appendUserMessage(text) {
    const row = document.createElement('div');
    row.className = 'message-row user';
    row.innerHTML = `
      <div class="message-bubble">
        ${escapeHtml(text)}
      </div>
    `;
    chatContainer.appendChild(row);
    scrollToBottom();
  }

  function appendAgentMessage(steps, replyText, fallbackTriggered = false, modelUsed = '') {
    const row = document.createElement('div');
    row.className = 'message-row agent';

    let fallbackBanner = '';
    if (fallbackTriggered && modelUsed) {
      fallbackBanner = `
        <div class="fallback-notice">
          <i class="fa-solid fa-shield-halved"></i> Auto-fallback used: <strong>${escapeHtml(modelUsed)}</strong>
        </div>
      `;
    }

    let stepsHtml = '';
    if (steps && steps.length > 0) {
      stepsHtml = steps.map(step => `
        <div class="tool-step-card">
          <div class="tool-step-header">
            <div class="tool-step-header-left">
              <i class="fa-solid fa-bolt"></i> Executed MCP Tool: <strong>${escapeHtml(step.tool)}</strong>
            </div>
            <span class="badge model-badge">MCP stdio</span>
          </div>
          <div class="tool-step-body">
            <span class="label">Tool Input:</span> ${escapeHtml(JSON.stringify(step.args, null, 2))}
            
            <span class="label">Live Output:</span>
${escapeHtml(step.output)}
          </div>
        </div>
      `).join('');
    }

    // Render markdown
    const formattedReply = typeof marked !== 'undefined' ? marked.parse(replyText) : escapeHtml(replyText);

    row.innerHTML = `
      <div class="message-bubble">
        ${fallbackBanner}
        ${stepsHtml}
        <div class="reply-markdown">${formattedReply}</div>
      </div>
    `;

    chatContainer.appendChild(row);
    scrollToBottom();
  }

  function appendRateLimitMessage(detailObj, originalPrompt) {
    if (activeCountdownInterval) {
      clearInterval(activeCountdownInterval);
    }

    const row = document.createElement('div');
    row.className = 'message-row agent';

    const retrySeconds = (detailObj && detailObj.retry_delay) ? detailObj.retry_delay : 30;
    const modelName = (detailObj && detailObj.model) ? detailObj.model : currentModel;
    const message = (detailObj && detailObj.message) ? detailObj.message : 'Gemini Free Tier Quota Exceeded (429 RESOURCE_EXHAUSTED).';
    const countdownId = 'countdown-' + Date.now();
    const retryBtnId = 'retry-btn-' + Date.now();
    const switchBtnId = 'switch-btn-' + Date.now();

    row.innerHTML = `
      <div class="message-bubble rate-limit-bubble">
        <div class="rate-limit-header">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>Gemini Free Tier Quota Limit Reached (${escapeHtml(modelName)})</span>
        </div>
        <div class="rate-limit-body">
          ${escapeHtml(message)}
          <br><br>
          Google Cloud enforces daily and per-minute quota limits on free-tier Gemini models. You can wait for the reset timer below, switch to another model, or configure your own API key in Settings.
        </div>
        
        <div class="rate-limit-actions">
          <span class="rate-limit-countdown" id="${countdownId}">
            <i class="fa-solid fa-clock"></i> Auto-retry ready in ${retrySeconds}s
          </span>
          <button id="${retryBtnId}" class="action-pill-btn primary">
            <i class="fa-solid fa-rotate-right"></i> Retry Now
          </button>
          <button id="${switchBtnId}" class="action-pill-btn secondary">
            <i class="fa-solid fa-arrow-right-arrow-left"></i> Switch to Gemini 2.5 Flash & Retry
          </button>
          <button class="action-pill-btn" onclick="document.getElementById('settings-modal').classList.remove('hidden')">
            <i class="fa-solid fa-key"></i> Settings / API Key
          </button>
        </div>
      </div>
    `;

    chatContainer.appendChild(row);
    scrollToBottom();

    // Start live countdown timer
    let remaining = retrySeconds;
    const timerElement = document.getElementById(countdownId);
    activeCountdownInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(activeCountdownInterval);
        if (timerElement) {
          timerElement.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #10b981;"></i> Ready to retry!';
        }
      } else {
        if (timerElement) {
          timerElement.innerHTML = `<i class="fa-solid fa-clock"></i> Auto-retry ready in ${remaining}s`;
        }
      }
    }, 1000);

    // Bind retry buttons
    document.getElementById(retryBtnId).addEventListener('click', () => {
      sendMessage(originalPrompt);
    });

    document.getElementById(switchBtnId).addEventListener('click', () => {
      setSelectedModel('gemini-2.5-flash');
      showToast('Switched model to Gemini 2.5 Flash', 'success');
      sendMessage(originalPrompt);
    });
  }

  function appendErrorMessage(msg, rawErr, originalPrompt) {
    const row = document.createElement('div');
    row.className = 'message-row agent';

    const retryBtnId = 'err-retry-' + Date.now();

    row.innerHTML = `
      <div class="message-bubble error-bubble">
        <div class="error-header">
          <i class="fa-solid fa-circle-exclamation"></i>
          <span>Agent Execution Encountered an Issue</span>
        </div>
        <div style="font-size: 0.9rem; color: #f1f5f9; margin-bottom: 8px;">
          ${escapeHtml(msg)}
        </div>
        ${rawErr ? `
          <details class="error-accordion">
            <summary>View Technical Details</summary>
            <div class="error-trace">${escapeHtml(rawErr)}</div>
          </details>
        ` : ''}
        <div class="rate-limit-actions" style="margin-top: 14px;">
          <button id="${retryBtnId}" class="action-pill-btn primary">
            <i class="fa-solid fa-rotate-right"></i> Retry Prompt
          </button>
          <button class="action-pill-btn" onclick="document.getElementById('settings-modal').classList.remove('hidden')">
            <i class="fa-solid fa-key"></i> Check API Key
          </button>
        </div>
      </div>
    `;

    chatContainer.appendChild(row);
    scrollToBottom();

    document.getElementById(retryBtnId).addEventListener('click', () => {
      sendMessage(originalPrompt);
    });
  }

  function showToast(message, type = 'info') {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
