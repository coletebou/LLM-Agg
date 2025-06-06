// API keys will be loaded from an optional secrets.js file
let OPENAI_API_KEY = 'API-KEY-HERE';
let GROK_API_KEY = 'API-KEY-HERE';
let GEMINI_API_KEY = 'API-KEY-HERE';

async function loadSecrets() {
  try {
    const secrets = await import(chrome.runtime.getURL('secrets.js'));
    OPENAI_API_KEY = secrets.OPENAI_API_KEY;
    GROK_API_KEY = secrets.GROK_API_KEY;
    GEMINI_API_KEY = secrets.GEMINI_API_KEY;
  } catch (e) {
    console.warn('secrets.js not found, using placeholder API keys');
  }
}

const mdWorker = new Worker(chrome.runtime.getURL('markdownWorker.js'));
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

// Function to update the popup width dynamically
function updatePopupWidth() {
  const cssMaxWidth = 800;
  const cssMinWidth = 300;

  requestAnimationFrame(() => {
    // Temporarily let the body expand to its natural width.
    const originalWidth = document.body.style.width;
    document.body.style.width = 'max-content';

    const scrollWidth = document.body.scrollWidth;
    const scrollbarWidth = document.body.offsetWidth - document.body.clientWidth;

    document.body.style.width = originalWidth;

    let newWidth = Math.ceil(scrollWidth + scrollbarWidth);
    newWidth = Math.min(newWidth, cssMaxWidth);
    newWidth = Math.max(newWidth, cssMinWidth);

    document.documentElement.style.width = newWidth + 'px';
    document.body.style.width = newWidth + 'px';
  });
}


// Loads non-sensitive settings like model names from settings.json
async function loadSettings() {
  return new Promise(async (resolve) => {
    try {
      const res = await fetch(chrome.runtime.getURL('settings.json'));
      settings = await res.json();
      // We don't store API keys here anymore, just model preferences etc.
      chrome.storage.local.set({ nonSensitiveSettings: settings }, resolve);
    } catch (e) {
      chrome.storage.local.get('nonSensitiveSettings', (data) => {
        settings = data.nonSensitiveSettings || {}; // Default to empty if not found
        resolve();
      });
    }
  });
}

async function loadPricing() {
  return new Promise(async (resolve) => {
    try {
      const res = await fetch(chrome.runtime.getURL('pricing.json'));
      pricing = await res.json();
      chrome.storage.local.set({ pricing }, resolve);
    } catch (e) {
      chrome.storage.local.get('pricing', (data) => {
        pricing = data.pricing || null;
        resolve();
      });
    }
  });
}

async function loadToggles() {
  return new Promise((resolve) => {
    chrome.storage.local.get('providerToggles', (data) => {
      providerToggles = {
        openai: true,
        grok: true,
        gemini: true,
        ...(data.providerToggles || {})
      };
      resolve();
    });
  });
}

function saveToggles() {
  chrome.storage.local.set({ providerToggles });
}

async function hashMessages(provider, messages) {
  const str = provider + JSON.stringify(messages);
  const buffer = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getCachedResponse(provider, messages) {
  const key = 'cache_' + (await hashMessages(provider, messages));
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (data) => {
      resolve(data[key]);
    });
  });
}

function setCachedResponse(provider, messages, result) {
  hashMessages(provider, messages).then((hash) => {
    const key = 'cache_' + hash;
    const entry = {};
    entry[key] = result;
    chrome.storage.local.set(entry);
  });
}


function loadHistory() {
  chrome.storage.local.get(['threads', 'currentThreadId'], (data) => {
    threads = (data.threads || []).map((t) => ({
      ...t,
      openaiMessages: t.openaiMessages || [],
      grokMessages: t.grokMessages || [],
      geminiMessages: t.geminiMessages || []
    }));
    currentThreadId = data.currentThreadId || null;
    renderHistory();
    if (currentThreadId) {
      const t = threads.find((th) => th.id === currentThreadId);
      if (t) {
        document.getElementById('results').innerHTML = t.html;
      }
    }
    updatePopupWidth();
  });
}

function saveHistory() {
  chrome.storage.local.set({ threads, currentThreadId });
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
  if (container) {
    container.style.display = 'block';
    updatePopupWidth();
  }
}

function hideHistory() {
  const container = document.getElementById('history');
  if (container) {
    container.style.display = 'none';
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
      el.textContent = 'Last PR: ' + new Date(date).toLocaleString();
    } else {
      el.textContent = 'Last PR: none';
    }
  } catch (e) {
    el.textContent = 'Last PR: unavailable';
  }
}

function renderHistory() {
  const container = document.getElementById('history');
  if (!container) return;
  container.innerHTML = '';
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
      const currentThreadData = threads.find(th => th.id === currentThreadId);
      document.getElementById('results').innerHTML = currentThreadData ? currentThreadData.html : '';
      saveHistory();
      hideHistory();
      updatePopupWidth();
    });
    container.appendChild(div);
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

async function askChatGPT(messages) {
  if (!OPENAI_API_KEY || OPENAI_API_KEY === "API-KEY-HERE") {
    return { text: "OpenAI API Key not configured in secrets.js" };
  }
  try {
    const start = performance.now();
    const url = 'https://api.openai.com/v1/chat/completions';
    const payload = {
      model: settings?.openai_model || 'gpt-3.5-turbo', 
      messages
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`, 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errorData = await res.text(); 
      return { text: `ChatGPT error: ${res.status} ${res.statusText}. Details: ${errorData}` };
    }
    const data = await res.json();
    const duration = performance.now() - start;
    return {
      text: data.choices?.[0]?.message?.content || 'No response',
      usage: data.usage,
      duration
    };
  } catch (err) {
    return { text: `ChatGPT error: ${err}` };
  }
}

async function askGrok(messages) {
  if (!GROK_API_KEY || GROK_API_KEY === "API-KEY-HERE") {
    return { text: "Grok API Key not configured in secrets.js" };
  }
  try {
    const start = performance.now();
    const url = 'https://api.x.ai/v1/chat/completions';
    const payload = {
      model: settings?.grok_model || 'grok-1', 
      messages
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROK_API_KEY}`, 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errorData = await res.text();
      return { text: `Grok error: ${res.status} ${res.statusText}. Details: ${errorData}` };
    }
    const data = await res.json();
    const duration = performance.now() - start;
    return {
      text: data.choices?.[0]?.message?.content || 'No response',
      usage: data.usage,
      duration
    };
  } catch (err) {
    return { text: `Grok error: ${err}` };
  }
}

async function askGemini(messages) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "API-KEY-HERE") {
    return { text: "Gemini API Key not configured in secrets.js" };
  }
  try {
    const start = performance.now();
    const model = settings?.gemini_model || 'gemini-pro'; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`; 
    const payload = {
      contents: messages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }))
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errorData = await res.text();
      return { text: `Gemini error: ${res.status} ${res.statusText}. Details: ${errorData}` };
    }
    const data = await res.json();
    const duration = performance.now() - start;
    const cand = data.candidates?.[0];
    return {
      text: cand?.content?.parts?.[0]?.text || 'No response',
      usage: data.usageMetadata,
      duration
    };
  } catch (err) {
    return { text: `Gemini error: ${err}` };
  }
}

async function showResult(container, label, result, modelName, provider) {
  const div = document.createElement('div');
  div.className = `result provider-${provider}`;

  const frag = document.createDocumentFragment();

  const title = document.createElement('h2');
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
  title.appendChild(copy);

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

  frag.appendChild(title);
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
  };

  ensureThread(question);
  const thread = threads.find((t) => t.id === currentThreadId);
  if (!thread) { 
      console.error("Current thread not found after ensureThread");
      loadingEl.style.display = 'none';
      return;
  }
  thread.openaiMessages.push({ role: 'user', content: question });
  thread.grokMessages.push({ role: 'user', content: question });
  thread.geminiMessages.push({ role: 'user', content: question });
  const group = document.createElement('div');
  group.className = 'question-group';
  resultsEl.prepend(group); 

  const qDiv = document.createElement('div');
  qDiv.className = 'user-question';
  qDiv.textContent = question;
  group.appendChild(qDiv);

  const tasks = [];
  const currentOpenAIMessages = [...thread.openaiMessages]; 
  const currentGrokMessages = [...thread.grokMessages];
  const currentGeminiMessages = [...thread.geminiMessages];

  if (providerToggles.openai) {
    tasks.push(
      getCachedResponse('openai', currentOpenAIMessages).then(async (cached) => {
        let res;
        if (cached) {
          res = cached;
          await showResult(group, 'ChatGPT', res, settings?.openai_model || 'gpt-3.5-turbo', 'openai');
        } else {
          res = await askChatGPT(currentOpenAIMessages);
          await showResult(group, 'ChatGPT', res, settings?.openai_model || 'gpt-3.5-turbo', 'openai');
          if (!res.text.includes("API Key not configured")) { 
            setCachedResponse('openai', currentOpenAIMessages, res);
          }
        }
        thread.openaiMessages.push({ role: 'assistant', content: res.text });
        updateLoading();
        return res;
      })
    );
  }
  if (providerToggles.grok) {
    tasks.push(
      getCachedResponse('grok', currentGrokMessages).then(async (cached) => {
        let res;
        if (cached) {
          res = cached;
          await showResult(group, 'Grok', res, settings?.grok_model || 'grok-1', 'grok');
        } else {
          res = await askGrok(currentGrokMessages);
          await showResult(group, 'Grok', res, settings?.grok_model || 'grok-1', 'grok');
          if (!res.text.includes("API Key not configured")) {
             setCachedResponse('grok', currentGrokMessages, res);
          }
        }
        thread.grokMessages.push({ role: 'assistant', content: res.text });
        updateLoading();
        return res;
      })
    );
  }
  if (providerToggles.gemini) {
    tasks.push(
      getCachedResponse('gemini', currentGeminiMessages).then(async (cached) => {
        let res;
        if (cached) {
          res = cached;
          await showResult(group, 'Gemini', res, settings?.gemini_model || 'gemini-pro', 'gemini');
        } else {
          res = await askGemini(currentGeminiMessages);
          await showResult(group, 'Gemini', res, settings?.gemini_model || 'gemini-pro', 'gemini');
           if (!res.text.includes("API Key not configured")) {
            setCachedResponse('gemini', currentGeminiMessages, res);
           }
        }
        thread.geminiMessages.push({ role: 'assistant', content: res.text });
        updateLoading();
        return res;
      })
    );
  }

  if (tasks.length === 0) {
    loadingEl.style.display = 'none';
    updatePopupWidth();
    return;
  }

  Promise.allSettled(tasks).then(() => {
    loadingEl.style.display = 'none';
    const finalThread = threads.find((t) => t.id === currentThreadId); 
    if (finalThread) {
      finalThread.html = resultsEl.innerHTML; 
      saveHistory();
      renderHistory();
    }
    updatePopupWidth();
  });
}

async function init() {
  await loadSecrets();
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
