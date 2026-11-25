import { examples, renderAvatarSvg } from "open-bot-avatar";
import { mountAvatar } from "open-bot-avatar/dom";
import { fluffy } from "open-bot-avatar/materials/fluffy";
import galleryBots from "./bots.json";

const BOTS = [...examples, ...galleryBots];
const BOT_BY_ID = new Map(BOTS.map((bot) => [bot.id, bot]));
const COLORS = ["#f4f4f4", "#a8693f", "#f2384b", "#ff6a1a", "#f8a01c", "#1fbf68", "#14b3a5", "#1f7cf2", "#8b5cf6", "#ec4899", "#7a7a7a"];
const MATERIALS = { flat: "flat", fluffy };
const LOOK_KEY = "milagre-live:avatar";
const mounted = new WeakMap();

function hashOf(text) {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return hash >>> 0;
}

const isLook = (look) => BOT_BY_ID.has(look?.shape) && /^#[0-9a-f]{6}$/i.test(look?.color ?? "") && look?.material in MATERIALS;

function randomLook() {
  const [shape, color] = crypto.getRandomValues(new Uint32Array(2));
  return { shape: BOTS[shape % BOTS.length].id, color: COLORS[color % COLORS.length], material: "flat" };
}

/** Someone who hasn't picked a bot (or runs a page from before the picker) gets one from their peer id. */
export function lookFor(seed) {
  const hash = hashOf(seed);
  return { shape: BOTS[hash % BOTS.length].id, color: COLORS[(hash >>> 8) % COLORS.length], material: "flat" };
}

export function loadLook() {
  try {
    const look = JSON.parse(localStorage.getItem(LOOK_KEY) ?? "null");
    if (isLook(look)) return look;
  } catch {
    /* falls through to a new one */
  }
  return saveLook(randomLook());
}

function saveLook(look) {
  localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  return look;
}

export function showBot(element, look, { working = false, follow = true } = {}) {
  const safe = isLook(look) ? look : lookFor(String(look?.shape));
  const key = `${safe.shape} ${safe.color} ${safe.material}`;
  const state = working ? "working" : "idle";
  const current = mounted.get(element);
  if (current?.key === key) return current.handle.update({ state });
  current?.handle.destroy();
  const handle = mountAvatar(element, {
    definition: BOT_BY_ID.get(safe.shape),
    color: safe.color,
    material: MATERIALS[safe.material],
    mood: "happy",
    state,
    followPointer: follow,
    label: "",
  });
  mounted.set(element, { key, handle });
}

export function hideBot(element) {
  mounted.get(element)?.handle.destroy();
  mounted.delete(element);
}

const $ = (id) => document.getElementById(id);

const picker = { look: null, onChange: () => {} };

function paintPicker() {
  const { look } = picker;
  showBot($("picker-preview"), look);
  for (const button of $("materials").children) button.setAttribute("aria-pressed", String(button.dataset.material === look.material));
  for (const button of $("swatches").children) button.setAttribute("aria-pressed", String(button.dataset.color === look.color));
  for (const button of $("shapes").children) {
    button.setAttribute("aria-pressed", String(button.dataset.shape === look.shape));
    if (button.dataset.color !== look.color) {
      button.innerHTML = renderAvatarSvg(BOT_BY_ID.get(button.dataset.shape), { color: look.color });
      button.dataset.color = look.color;
    }
  }
}

function pick(next) {
  picker.look = saveLook({ ...picker.look, ...next });
  paintPicker();
  picker.onChange(picker.look);
}

function setUpPicker() {
  const dialog = $("picker");
  $("swatches").append(
    ...COLORS.map((color) => {
      const button = Object.assign(document.createElement("button"), { type: "button", className: "swatch" });
      button.dataset.color = color;
      button.style.background = color;
      button.setAttribute("aria-label", color);
      return button;
    }),
  );
  $("shapes").append(
    ...BOTS.map((bot) => {
      const button = Object.assign(document.createElement("button"), { type: "button", className: "shape", title: bot.name });
      button.dataset.shape = bot.id;
      button.setAttribute("aria-label", bot.name);
      return button;
    }),
  );
  const choose = (field) => (event) => {
    const button = event.target.closest(`[data-${field}]`);
    if (button) pick({ [field]: button.dataset[field] });
  };
  $("materials").addEventListener("click", choose("material"));
  $("swatches").addEventListener("click", choose("color"));
  $("shapes").addEventListener("click", choose("shape"));
  $("shuffle").addEventListener("click", () => pick({ ...randomLook(), material: picker.look.material }));
  $("picker-done").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => hideBot($("picker-preview")));
  dialog.addEventListener("click", (event) => event.target === dialog && dialog.close());
}

/** The avatar dialog: a live preview, Flat or Fluffy, a color, a shape. Every change is saved and passed to `onChange`. */
export function openPicker(current, onChange) {
  if (!$("swatches").childElementCount) setUpPicker();
  Object.assign(picker, { look: { ...current }, onChange });
  paintPicker();
  $("picker").showModal();
}
