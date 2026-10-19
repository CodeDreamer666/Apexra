'use strict';
// Explicit allowlist: never clear unrelated applications sharing this origin.
const apexraSaveKeys = [
  'apexgp.settings.v1', 'apexgp.gfx.v1', 'apexgp.progress.v4',
  'apexgp.progress.v3', 'apexgp.career.v1', 'apexgp.ranked.v1',
];
document.getElementById('clear-data').addEventListener('click', () => {
  if (!window.confirm('Permanently erase Apexra Career progress, unlocked ranks, race history, VR rating and saved settings in this browser? This cannot be undone. Close other Apexra game tabs first so they cannot write an old save back.')) return;
  const status = document.getElementById('clear-status');
  try {
    for (const key of apexraSaveKeys) localStorage.removeItem(key);
    status.textContent = 'Apexra saves and settings have been cleared in this browser. Return to the game to start fresh.';
  } catch {
    status.textContent = 'Browser storage could not be fully cleared. Use your browser’s site-data settings to remove Apexra data.';
  }
});
