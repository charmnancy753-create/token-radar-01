// dashboard/app.js — Token Radar v2 UI
// Written by Ada Wrong in-session.

window.addEventListener('DOMContentLoaded', () => {
  const radar = window.radar || {};
  const tbody = document.querySelector('#board tbody');
  if (!tbody) return;
  // Board rows injected by dataScript via server render; keep this minimal.
  const box = document.getElementById('radar');
  if (box) {
    box.innerHTML = `<p>Early: ${radar.early_size ?? 0}  Live set aside: ${radar.live_size ?? 0}</p>`;
  }
});
