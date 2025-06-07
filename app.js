// This file has been updated to use a secure PHP proxy.
// It no longer contains or loads API keys directly.

const mdWorker = new Worker('markdownWorker.js');
function parseMarkdown(md) {
  return new Promise((resolve) => {
    const handler = (e) => {
      mdWorker.removeEventListener('message', handler);
      resolve(e.data.html);
    };
    mdWorker.addEventListener('message', handler);
    mdWorker.postMessage({ markdown: md });
  });
}

let settings = null; // Will store model names and other non-sensitive settings
let pricing = null;
let threads = [];
let currentThreadId = null;
let providerToggles = { openai: true, grok: true, gemini: true };
let currentAbortController = null;

// Function to update the popup width dynamically
function updatePopupWidth() {
  requestAnimationFrame(() => {
    // Remove fixed width constraints
    document.documentElement.style.width = '100vw';
    document.body.style.width = '100%';
    document.body.style.maxWidth = '100vw';
  });
}


// Loads non-sensitive settings like model names from settings.json
async function loadSettings() {
  try {
    const res = await fetch('settings.json');
    settings = await res.json();
    localStorage.setItem('nonSensitiveSettings', JSON.stringify(settings));
  } catch (e) {
    const saved = localStorage.getItem('nonSensitiveSettings');
    settings = saved ? JSON.parse(saved) : {};
  }
}

async function loadPricing() {
  try {
    const res = await fetch('pricing.json');
    pricing = await res.json();
    localStorage.setItem('pricing', JSON.stringify(pricing));
  } catch (e) {
    const saved = localStorage.getItem('pricing');
    pricing = saved ? JSON.parse(saved) : null;
  }
}

async function loadToggles() {
  const saved = localStorage.getItem('providerToggles');
  providerToggles = {
    openai: true,
    grok: true,
    gemini: true,
    ...(saved ? JSON.parse(saved) : {})
  };
}

function saveToggles() {
  localStorage.setItem('providerToggles', JSON.stringify(providerToggles));
}

async function hashMessages(provider, messages) {
  const str = provider + JSON.stringify(messages);
  const buffer = new TextEncoder().encode(str);
  if (crypto.subtle && crypto.subtle.digest) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback for insecure contexts where SubtleCrypto is unavailable
  let hash = 0;
  for (const byte of buffer) {
    hash = (hash * 31 + byte) >>> 0;
  }
  return hash.toString(16);
}

async function getCachedResponse(provider, messages) {
  const key = 'cache_' + (await hashMessages(provider, messages));
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) : null;
}

function setCachedResponse(provider, messages, result) {
  hashMessages(provider, messages).then((hash) => {
    const key = 'cache_' + hash;
    localStorage.setItem(key, JSON.stringify(result));
  });
}


function loadHistory() {
  const storedThreads = localStorage.getItem('threads');
  threads = storedThreads ? JSON.parse(storedThreads) : [];
  threads = threads.map((t) => ({
    ...t,
    openaiMessages: t.openaiMessages || [],
    grokMessages: t.grokMessages || [],
    geminiMessages: t.geminiMessages || []
  }));
  const storedId = localStorage.getItem('currentThreadId');
  currentThreadId = storedId ? JSON.parse(storedId) : null;
  renderHistory();
  if (currentThreadId) {
    const t = threads.find((th) => th.id === currentThreadId);
    if (t) {
      document.getElementById('results').innerHTML = t.html;
    }
  }
  updatePopupWidth();
}

function saveHistory() {
  localStorage.setItem('threads', JSON.stringify(threads));
  localStorage.setItem('currentThreadId', JSON.stringify(currentThreadId));
}

function ensureThread(question) {
  if (!currentThreadId) {
    currentThreadId = Date.now();
    threads.unshift({
      id: currentThreadId,
      start: question.slice(0, 30),
      date: new Date().toLocaleString(),
      html: '',
      openaiMessages: [],
      grokMessages: [],
      geminiMessages: []
    });
    saveHistory();
    renderHistory();
  }
}

function deleteHistoryItem(id) {
  threads = threads.filter((t) => t.id !== id);
  if (currentThreadId === id) {
      document.getElementById('results').innerHTML = '';
      currentThreadId = null;
  }
  saveHistory();
  renderHistory();
  updatePopupWidth();
}

function clearHistory() {
  threads = [];
  currentThreadId = null;
  document.getElementById('results').innerHTML = '';
  saveHistory();
  renderHistory();
  updatePopupWidth();
}

function showHistory() {
  const container = document.getElementById('history');
  const clearBtn = document.getElementById('clear-history');
  if (container) {
    container.style.display = 'block';
    if (clearBtn) clearBtn.style.display = 'block';
    updatePopupWidth();
  }
}

function hideHistory() {
  const container = document.getElementById('history');
  const clearBtn = document.getElementById('clear-history');
  if (container) {
    container.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'none';
    updatePopupWidth();
  }
}

async function showLastPRDate() {
  const el = document.getElementById('last-pr-date');
  if (!el) return;
  try {
    const res = await fetch('https://api.github.com/repos/coletebou/LLM-Agg/pulls?state=closed&sort=updated&direction=desc&per_page=1');
    if (!res.ok) throw new Error('Request failed');
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const pr = data[0];
      const date = pr.merged_at || pr.closed_at || pr.updated_at || pr.created_at;
      const dateStr = new Date(date).toLocaleString();
      el.textContent = 'Last PR: ' + pr.title + ' (' + dateStr + ')';
    } else {
      el.textContent = 'Last PR: none';
    }
  } catch (e) {
    el.textContent = 'Last PR: unavailable';
  }
}

function renderHistory() {
  const container = document.getElementById('history');
  const historyItems = container?.querySelector('.history-items');
  const clearBtn = document.getElementById('clear-history');
  
  if (!container || !historyItems) return;
  
  historyItems.innerHTML = '';
  
  // Show clear history button if there are threads
  if (clearBtn) {
    clearBtn.style.display = threads.length > 0 ? 'block' : 'none';
  }
  
  threads.forEach((t) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const text = document.createElement('span');
    text.textContent = `${t.start} (${t.date})`;
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteHistoryItem(t.id);
    });
    div.appendChild(text);
    div.appendChild(del);
    div.addEventListener('click', () => {
      currentThreadId = t.id;
      const currentThreadData = threads.find((th) => th.id === currentThreadId);
      document.getElementById('results').innerHTML = currentThreadData ? currentThreadData.html : '';
      saveHistory();
      hideHistory();
      updatePopupWidth();
    });
    historyItems.appendChild(div);
  });
}

function getUnitCost(provider, model) {
  if (!pricing || !pricing[provider]) return { input: 0, output: 0 };
  const entry = pricing[provider];
  const cost = entry[model] ?? entry.default ?? { input: 0, output: 0 };
  if (typeof cost === 'number') {
    return { input: cost, output: cost };
  }
  const input = typeof cost.input === 'number' ? cost.input : 0;
  const output = typeof cost.output === 'number' ? cost.output : 0;
  return { input, output };
}


// --- START: New Proxy-based API functions ---

// A single, generic function to call our proxy.
// This function sends requests to our proxy.php file instead of directly to the API providers.
async function askProxy(provider, payload, signal, modelNameForGemini = null) {
  try {
    const start = performance.now();
    const url = 'proxy.php'; // The URL of our new PHP proxy file

    let proxyPayload = {
      provider: provider,
      payload: payload
    };
    
    // Gemini needs the model name in its URL, which is constructed by the proxy.
    // We pass the model name along in the payload for the proxy to use.
    if (provider === 'gemini' && modelNameForGemini) {
        proxyPayload.payload.model = modelNameForGemini;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(proxyPayload),
      signal // Pass the AbortController's signal to make the request cancellable
    });

    if (!res.ok) {
      const errorData = await res.text();
      return { text: `${provider} proxy error: ${res.status} ${res.statusText}. Details: ${errorData}` };
    }

    const data = await res.json();
    const duration = performance.now() - start;
    
    // The response structure is slightly different for Gemini.
    if (provider === 'gemini') {
        const cand = data.candidates?.[0];
        return {
            text: cand?.content?.parts?.[0]?.text || 'No response',
            usage: data.usageMetadata,
            duration
        };
    } else {
        return {
            text: data.choices?.[0]?.message?.content || 'No response',
            usage: data.usage,
            duration
        };
    }
  } catch (err) {
    if (err.name === 'AbortError') return { canceled: true };
    return { text: `${provider} proxy error: ${err}` };
  }
}

// Update the original functions to use the new proxy function.
// Their purpose now is to prepare the payload in the correct format for each provider.
async function askChatGPT(messages, signal) {
  const payload = { model: settings?.openai_model || 'gpt-3.5-turbo', messages };
  return await askProxy('openai', payload, signal);
}

async function askGrok(messages, signal) {
  const payload = { model: settings?.grok_model || 'grok-1', messages };
  return await askProxy('grok', payload, signal);
}

async function askGemini(messages, signal) {
    const model = settings?.gemini_model || 'gemini-pro';
    const payload = {
        contents: messages.map((m) => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
        }))
    };
    // Pass the model name separately for Gemini's URL construction in the proxy.
    return await askProxy('gemini', payload, signal, model);
}

// --- END: New Proxy-based API functions ---


async function showResult(container, label, result, modelName, provider) {
  // Check if we need to create tabs
  if (!container.querySelector('.tabs')) {
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    
    ['openai', 'grok', 'gemini'].forEach(p => {
      const tab = document.createElement('div');
      tab.className = `tab ${p}`;
      tab.textContent = p === 'openai' ? 'ChatGPT' : p.charAt(0).toUpperCase() + p.slice(1);
      tab.addEventListener('click', () => {
        // Remove active class from all tabs and results
        container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        container.querySelectorAll('.result').forEach(r => r.classList.remove('active'));
        
        // Add active class to clicked tab and corresponding result
        tab.classList.add('active');
        container.querySelector(`.result.provider-${p}`)?.classList.add('active');
      });
      tabs.appendChild(tab);
    });
    
    container.insertBefore(tabs, container.firstChild);
  }

  const div = document.createElement('div');
  div.className = `result provider-${provider}`;

  // Make this result active if it's the first one
  if (!container.querySelector('.result')) {
    div.classList.add('active');
    container.querySelector(`.tab.${provider}`)?.classList.add('active');
  }

  const frag = document.createDocumentFragment();

  const header = document.createElement('div');
  header.className = 'result-header';

  const title = document.createElement('h2');
  title.className = 'provider-name';
  title.textContent = label;

  const copy = document.createElement('span');
  copy.className = 'copy-btn';
  copy.textContent = 'Copy';
  copy.addEventListener('click', () => {
    const textarea = document.createElement('textarea');
    textarea.value = result.text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      console.error('Fallback: Oops, unable to copy', err);
    }
    document.body.removeChild(textarea);
  });

  header.appendChild(title);
  header.appendChild(copy);

  const content = document.createElement('div');
  content.innerHTML = await parseMarkdown(result.text);

  const summary = document.createElement('div');
  summary.className = 'result-summary'; // Add class for specific styling
  const usage = result.usage || {};
  const inputTokens =
    usage.prompt_tokens ??
    usage.inputTokenCount ??
    usage.promptTokenCount ??
    0;
  const outputTokens =
    usage.completion_tokens ??
    usage.outputTokenCount ??
    usage.candidatesTokenCount ??
    0;
  const totalTokens =
    usage.total_tokens ??
    usage.totalTokenCount ??
    inputTokens + outputTokens;
  const unitCost = getUnitCost(provider, modelName);
  const inputPerTok = unitCost.input / 1e6;
  const outputPerTok = unitCost.output / 1e6;
  const totalCost = (
    inputTokens * inputPerTok + outputTokens * outputPerTok
  ).toFixed(5);
  summary.textContent =
    `Model: ${modelName} | Input $${unitCost.input}/Mtok, ` +
    `Output $${unitCost.output}/Mtok | ` +
    `Tokens: ${totalTokens} (in ${inputTokens}, out ${outputTokens}) | ` +
    `Total Cost: $${totalCost}`;

  const timing = document.createElement('div');
  timing.className = 'result-summary'; // Add class for specific styling
  if (typeof result.duration === 'number') {
    const secs = (result.duration / 1000).toFixed(2);
    timing.textContent = `Response time: ${secs}s`;
  }

  frag.appendChild(header);
  frag.appendChild(content);
  frag.appendChild(summary);
  if (timing.textContent) frag.appendChild(timing);
  div.appendChild(frag);
  container.appendChild(div);
  updatePopupWidth();
}

async function askAll(question) {
  const resultsEl = document.getElementById('results');
  const loadingEl = document.getElementById('loading');
  const textEl = document.getElementById('loading-text');
  const cancelBtn = document.getElementById('cancel-loading');
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;
  const tasks = [];
  
  // Create question group and results row
  const group = document.createElement('div');
  group.className = 'question-group';
  resultsEl.prepend(group);

  const qDiv = document.createElement('div');
  qDiv.className = 'user-question';
  qDiv.textContent = question;
  group.appendChild(qDiv);

  // Create row for results
  const resultsRow = document.createElement('div');
  resultsRow.className = 'results-row';
  group.appendChild(resultsRow);

  let canceled = false;
  if (cancelBtn) {
    cancelBtn.style.display = 'inline';
    cancelBtn.onclick = () => {
      canceled = true;
      currentAbortController.abort();
      loadingEl.style.display = 'none';
      cancelBtn.style.display = 'none';
    };
  }

  const activeProviders = ['openai', 'grok', 'gemini'].filter(
    (p) => providerToggles[p]
  );
  const total = activeProviders.length;
  let completed = 0;
  loadingEl.style.display = 'flex';
  textEl.textContent = `Loading: ${completed} of ${total}`;
  
  const updateLoading = () => {
    completed++;
    textEl.textContent = `Loading: ${completed} of ${total}`;
    if (completed === total) {
      loadingEl.style.display = 'none';
      if (cancelBtn) cancelBtn.style.display = 'none';
    }
  };

  ensureThread(question);
  const thread = threads.find((t) => t.id === currentThreadId);
  if (!thread) return;

  // Add the new user message to each model's conversation history
  thread.openaiMessages.push({ role: 'user', content: question });
  thread.grokMessages.push({ role: 'user', content: question });
  thread.geminiMessages.push({ role: 'user', content: question });

  const currentOpenAIMessages = [...thread.openaiMessages];
  const currentGrokMessages = [...thread.grokMessages];
  const currentGeminiMessages = [...thread.geminiMessages];

  if (providerToggles.openai) {
    const cached = await getCachedResponse('openai', currentOpenAIMessages);
    if (cached && !canceled) {
      showResult(resultsRow, 'ChatGPT', cached, settings?.openai_model || 'gpt-3.5-turbo', 'openai');
      // Store the cached response in conversation history
      thread.openaiMessages.push({ role: 'assistant', content: cached.text });
      updateLoading();
    } else {
      tasks.push(
        askChatGPT(currentOpenAIMessages, signal).then((result) => {
          if (!result.canceled && !canceled) {
            setCachedResponse('openai', currentOpenAIMessages, result);
            const model = settings?.openai_model || 'gpt-3.5-turbo';
            showResult(resultsRow, 'ChatGPT', result, model, 'openai');
            // Store the response in conversation history
            thread.openaiMessages.push({ role: 'assistant', content: result.text });
          }
          updateLoading();
        })
      );
    }
  }

  if (providerToggles.grok) {
    const cached = await getCachedResponse('grok', currentGrokMessages);
    if (cached && !canceled) {
      showResult(resultsRow, 'Grok', cached, settings?.grok_model || 'grok-1', 'grok');
      // Store the cached response in conversation history
      thread.grokMessages.push({ role: 'assistant', content: cached.text });
      updateLoading();
    } else {
      tasks.push(
        askGrok(currentGrokMessages, signal).then((result) => {
          if (!result.canceled && !canceled) {
            setCachedResponse('grok', currentGrokMessages, result);
            const model = settings?.grok_model || 'grok-1';
            showResult(resultsRow, 'Grok', result, model, 'grok');
            // Store the response in conversation history
            thread.grokMessages.push({ role: 'assistant', content: result.text });
          }
          updateLoading();
        })
      );
    }
  }

  if (providerToggles.gemini) {
    const cached = await getCachedResponse('gemini', currentGeminiMessages);
    if (cached && !canceled) {
      showResult(resultsRow, 'Gemini', cached, settings?.gemini_model || 'gemini-pro', 'gemini');
      // Store the cached response in conversation history
      thread.geminiMessages.push({ role: 'assistant', content: cached.text });
      updateLoading();
    } else {
      tasks.push(
        askGemini(currentGeminiMessages, signal).then((result) => {
          if (!result.canceled && !canceled) {
            setCachedResponse('gemini', currentGeminiMessages, result);
            const model = settings?.gemini_model || 'gemini-pro';
            showResult(resultsRow, 'Gemini', result, model, 'gemini');
            // Store the response in conversation history
            thread.geminiMessages.push({ role: 'assistant', content: result.text });
          }
          updateLoading();
        })
      );
    }
  }

  if (tasks.length === 0) {
    loadingEl.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
    return;
  }

  Promise.all(tasks.map(p => p.catch(err => console.error(err)))).then(() => {
    if (!canceled) {
      thread.html = resultsEl.innerHTML;
      saveHistory();
    }
    loadingEl.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
  });
}

async function init() {
  // `loadSecrets()` is no longer needed and has been removed.
  await loadSettings();
  await loadPricing();
  await loadToggles();
  await showLastPRDate();
  loadHistory();
  const form = document.getElementById('question-form');
  const questionInput = document.getElementById('question');
  if (form && questionInput) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = questionInput.value.trim();
      if (q) {
        askAll(q);
      }
    });
    questionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const q = questionInput.value.trim();
        if (q) {
          askAll(q);
        }
      }
    });
    questionInput.addEventListener('input', () => {
      questionInput.style.height = 'auto';
      questionInput.style.height = questionInput.scrollHeight + 'px';
      updatePopupWidth();
    });
  }
  const clr = document.getElementById('clear-history');
  if (clr) {
    clr.addEventListener('click', clearHistory);
  }
  const toggle = document.getElementById('toggle-history');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const container = document.getElementById('history');
      if (container.style.display === 'block') {
        hideHistory();
      } else {
        showHistory();
      }
    });
  }
  const newChat = document.getElementById('new-chat');
  if (newChat) {
    newChat.addEventListener('click', () => {
      currentThreadId = null;
      document.getElementById('results').innerHTML = '';
      document.getElementById('question').value = '';
      saveHistory(); 
      renderHistory(); 
      updatePopupWidth();
    });
  }

  ['openai', 'grok', 'gemini'].forEach((name) => {
    const cb = document.getElementById(`toggle-${name}`);
    if (cb) {
      cb.checked = providerToggles[name];
      cb.addEventListener('change', () => {
        providerToggles[name] = cb.checked;
        saveToggles();
      });
    }
  });
  updatePopupWidth();
}

document.addEventListener('DOMContentLoaded', init);
