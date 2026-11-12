// Het "brein" van Assistant22: één functie, meerdere AI-providers.
// Geeft altijd { text, usage: { input, output, cost } } terug.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runClaude } = require('./claude');

const PROVIDERS = {
  'claude-code': { name: 'Claude Code (subscription)', kind: 'cli', defaultModel: '' },
  codex: { name: 'ChatGPT – Codex CLI (subscription)', kind: 'cli', defaultModel: '' },
  anthropic: { name: 'Claude API', kind: 'api', base: 'https://api.anthropic.com/v1', defaultModel: 'claude-haiku-5-5', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { name: 'ChatGPT API (OpenAI)', kind: 'api', base: 'https://api.openai.com/v1', defaultModel: 'gpt-5-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  xai: { name: 'Grok API (xAI)', kind: 'api', base: 'https://api.x.ai/v1', defaultModel: 'grok-4-fast', keyUrl: 'https://console.x.ai/' },
  gemini: { name: 'Gemini API (Google)', kind: 'api', base: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/apikey' },
  ollama: { name: 'Ollama (local, free)', kind: 'api', base: 'http://localhost:11434/v1', defaultModel: 'llama3.2', noKey: true },
};

function timeoutSignal(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms).unref?.();
  return c.signal;
}

// OpenAI-compatibele chat (OpenAI, Grok, Gemini, Ollama)
async function openaiCompat(cfg, prompt, p) {
  const base = (cfg.baseUrl || p.base).replace(/\/$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
  const r = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers,
    signal: timeoutSignal(180000),
    body: JSON.stringify({ model: cfg.model || p.defaultModel, messages: [{ role: 'user', content: prompt }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p.name}: ${(j.error && (j.error.message || j.error)) || r.status}`);
  const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!text) throw new Error(`${p.name}: empty answer`);
  const u = j.usage || {};
  return { text: Array.isArray(text) ? text.map((x) => x.text || '').join('') : text, usage: { input: u.prompt_tokens || 0, output: u.completion_tokens || 0, cost: 0 } };
}

async function anthropicApi(cfg, prompt, p) {
  const r = await fetch((cfg.baseUrl || p.base).replace(/\/$/, '') + '/messages', {
    method: 'POST',
    signal: timeoutSignal(180000),
    headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.model || p.defaultModel, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Claude API: ' + ((j.error && j.error.message) || r.status));
  const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const u = j.usage || {};
  return { text, usage: { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0), output: u.output_tokens || 0, cost: 0 } };
}

// Codex CLI (ChatGPT-abonnement). Antwoord via --output-last-message, verbruik uit --json.
function codexCli(cfg, prompt, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const outFile = path.join(os.tmpdir(), `a22-codex-${process.pid}-${Date.now()}.txt`);
    const args = ['exec', '--skip-git-repo-check', '--json', '--output-last-message', outFile];
    if (cfg.model) args.push('--model', cfg.model);
    args.push('-');
    const child = spawn(cfg.command || 'codex', args, { cwd, shell: process.platform === 'win32', windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Codex did not answer in time')); }, 240000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Can't start Codex CLI (${e.message}). Install it with "npm i -g @openai/codex" and run "codex login".`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let text = '';
      try { text = fs.readFileSync(outFile, 'utf8').trim(); fs.unlinkSync(outFile); } catch { /* geen bestand */ }
      if (!text) {
        if (/not recognized|not found|ENOENT/i.test(err + out)) return reject(new Error('Codex CLI not found. Install it with "npm i -g @openai/codex" and run "codex login".'));
        return reject(new Error(`Codex stopped with code ${code}: ${(err || out).slice(-300)}`));
      }
      let input = 0;
      let output = 0;
      for (const line of out.split('\n')) {
        const m = line.match(/"input_tokens"\s*:\s*(\d+)/);
        const n = line.match(/"output_tokens"\s*:\s*(\d+)/);
        if (m) input = Math.max(input, Number(m[1]));
        if (n) output = Math.max(output, Number(n[1]));
      }
      resolve({ text, usage: { input, output, cost: 0 } });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function complete(aiCfg, prompt, { cwd } = {}) {
  const provider = aiCfg.provider || 'claude-code';
  const p = PROVIDERS[provider];
  if (!p) throw new Error('Unknown AI provider ' + provider);
  const cfg = (aiCfg.providers && aiCfg.providers[provider]) || {};
  if (p.kind === 'api' && !p.noKey && !cfg.apiKey) throw new Error(`${p.name}: no API key set`);
  if (provider === 'claude-code') {
    const r = await runClaude(prompt, { command: cfg.command || 'claude', model: cfg.model || '', cwd, withUsage: true });
    return r;
  }
  if (provider === 'codex') return codexCli(cfg, prompt, { cwd });
  if (provider === 'anthropic') return anthropicApi(cfg, prompt, p);
  return openaiCompat(cfg, prompt, p);
}

module.exports = { complete, PROVIDERS };
