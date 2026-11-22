/**
 * The small row of controls at the top of the side panel: volume (click the speaker
 * to mute), room tone, and the room's echo. Remembered per browser.
 */
import { applyPrefs, prefs } from "./fx.ts";

const KEY = "zen:sound";

const icon = (paths: string) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const SPEAKER = '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>';
const ICONS = {
  volume: icon(SPEAKER + '<path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  muted: icon(SPEAKER + '<path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  ambience: icon('<path d="M3 9c3-2 6 2 9 0s6-2 9 0"/><path d="M3 14c3-2 6 2 9 0s6-2 9 0"/>'),
  room: icon('<circle cx="12" cy="12" r="1.6"/><path d="M8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8"/><path d="M5 5a9.9 9.9 0 0 0 0 14M19 5a9.9 9.9 0 0 1 0 14"/>'),
};

function load() {
  try {
    Object.assign(prefs, JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {}
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
}

export function mountControls(el: HTMLElement) {
  load();
  applyPrefs();
  el.innerHTML = `
    <div class="vol">
      <button type="button" id="c-mute" class="ctl" aria-label="mute"></button>
      <input type="range" id="c-volume" min="0" max="1" step="0.01" aria-label="volume" />
    </div>
    <button type="button" id="c-ambience" class="ctl" title="room tone" aria-label="room tone">${ICONS.ambience}</button>
    <button type="button" id="c-room" class="ctl" title="echo of the room" aria-label="echo of the room">${ICONS.room}</button>`;
  const mute = el.querySelector<HTMLButtonElement>("#c-mute")!;
  const volume = el.querySelector<HTMLInputElement>("#c-volume")!;
  const amb = el.querySelector<HTMLButtonElement>("#c-ambience")!;
  const room = el.querySelector<HTMLButtonElement>("#c-room")!;

  const sync = () => {
    mute.innerHTML = prefs.muted || prefs.volume === 0 ? ICONS.muted : ICONS.volume;
    mute.title = prefs.muted ? "unmute" : "mute";
    mute.setAttribute("aria-pressed", String(prefs.muted));
    volume.value = String(prefs.volume);
    volume.style.setProperty("--fill", `${prefs.volume * 100}%`);
    amb.setAttribute("aria-pressed", String(prefs.ambience));
    room.setAttribute("aria-pressed", String(prefs.room));
    applyPrefs();
    save();
  };
  mute.onclick = () => ((prefs.muted = !prefs.muted), sync());
  volume.oninput = () => {
    prefs.volume = Number(volume.value);
    prefs.muted = false;
    sync();
  };
  amb.onclick = () => ((prefs.ambience = !prefs.ambience), sync());
  room.onclick = () => ((prefs.room = !prefs.room), sync());
  sync();
}
