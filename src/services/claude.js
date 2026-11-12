// Roept Claude Code aan in print-mode (`claude -p`). Draait op het
// abonnement van de gebruiker, dus geen API-sleutel nodig.
const { spawn } = require('child_process');

// Zoek claude op bekende installatieplekken als het niet in PATH staat
// (bv. als Claude Code net is geïnstalleerd en Postvak nog de oude PATH heeft).
function resolveCommand(command) {
  if (command && command !== 'claude') return command;
  const fs = require('fs');
  const path = require('path');
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const candidates = process.platform === 'win32'
    ? [
        path.join(home, '.local', 'bin', 'claude.exe'),
        path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
      ]
    : [path.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude'];
  const found = candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  return found ? `"${found}"` : 'claude';
}

function runClaude(prompt, { command = 'claude', model = '', cwd, timeoutMs = 180000, withUsage = false } = {}) {
  command = resolveCommand(command);
  return new Promise((resolve, reject) => {
    // Geen tools: Claude hoeft alleen te lezen wat we meegeven en JSON terug te geven.
    // Zo kan een kwaadaardige mail Claude niet laten rondneuzen op je pc.
    const args = ['-p', '--output-format', 'json', '--disallowedTools', 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task'];
    if (model) args.push('--model', model);
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === 'win32', // claude.cmd op Windows
      windowsHide: true,
      env: process.env,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Claude Code reageerde niet op tijd'));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Kan Claude Code niet starten (${e.message}). Is het geïnstalleerd en ingelogd?`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let parsed;
      try { parsed = JSON.parse(out); } catch { /* geen json */ }
      if (parsed && typeof parsed.result === 'string' && !parsed.is_error) {
        if (!withUsage) return resolve(parsed.result);
        const u = parsed.usage || {};
        return resolve({
          text: parsed.result,
          usage: {
            input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
            output: u.output_tokens || 0,
            cost: parsed.total_cost_usd || 0,
          },
        });
      }
      if (parsed && parsed.is_error) return reject(new Error('Claude Code fout: ' + (parsed.result || 'onbekend')));
      if (code === 0 && out.trim()) return resolve(withUsage ? { text: out.trim(), usage: { input: 0, output: 0, cost: 0 } } : out.trim());
      if (/not recognized|not found|ENOENT/i.test(err + out)) return reject(new Error('Claude Code niet gevonden. Installeer het (PowerShell: irm https://claude.ai/install.ps1 | iex), log één keer in met "claude" en herstart Postvak.'));
      reject(new Error(`Claude Code stopte met code ${code}: ${(err || out).slice(0, 400)}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Haal het eerste JSON-object uit een antwoord (ook als het in ```json staat).
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Geen JSON in antwoord van Claude');
  return JSON.parse(body.slice(start, end + 1));
}

module.exports = { runClaude, extractJson };
