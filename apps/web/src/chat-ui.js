// The room's chat panel: messages with links, code blocks and images, a composer that takes pasted images, and an
// unread count on the dock button while the panel is closed.
const $ = (id) => document.getElementById(id);
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;
const MAX_SIDE = 1280;
const MAX_DATA = 290_000;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Plain text with inline `code` and clickable links, built from text nodes so nothing posted runs as HTML. */
function inline(text, into) {
  const parts = text.split(/(`[^`\n]+`)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      into.append(el("code", "chat-inline", part.slice(1, -1)));
      continue;
    }
    let last = 0;
    for (const match of part.matchAll(URL_PATTERN)) {
      into.append(part.slice(last, match.index));
      const link = el("a", "", match[0]);
      link.href = match[0];
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      into.append(link);
      last = match.index + match[0].length;
    }
    into.append(part.slice(last));
  }
}

function codeBlock(code) {
  const box = el("div", "chat-code");
  const copy = el("button", "chat-copy", "Copy");
  copy.type = "button";
  copy.addEventListener("click", () =>
    navigator.clipboard.writeText(code).then(
      () => ((copy.textContent = "Copied"), setTimeout(() => (copy.textContent = "Copy"), 1500)),
      () => {},
    ),
  );
  box.append(copy, el("pre", "", code));
  return box;
}

/** Text split into paragraphs and ``` fenced code blocks. */
function body(text) {
  const out = [];
  const fence = /```[\w+-]*\n?([\s\S]*?)```/g;
  let last = 0;
  for (const match of text.matchAll(fence)) {
    const before = text.slice(last, match.index).trim();
    if (before) {
      const p = el("div", "chat-text");
      inline(before, p);
      out.push(p);
    }
    out.push(codeBlock(match[1].replace(/\n$/, "")));
    last = match.index + match[0].length;
  }
  const rest = text.slice(last).trim();
  if (rest) {
    const p = el("div", "chat-text");
    inline(rest, p);
    out.push(p);
  }
  const first = text.replace(fence, "").match(URL_PATTERN)?.[0];
  if (first) {
    try {
      const url = new URL(first);
      const card = el("a", "chat-link");
      card.href = first;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.append(el("b", "", url.hostname.replace(/^www\./, "")), el("span", "", decodeURI(url.pathname + url.search).slice(0, 80) || "/"));
      out.push(card);
    } catch {
      /* not a link after all */
    }
  }
  return out;
}

const clock = (at) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Shrinks a picture to at most 1280 px and about 290 KB of JPEG, as a data URL. */
async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  for (const [side, quality] of [
    [MAX_SIDE, 0.82],
    [960, 0.7],
    [720, 0.6],
  ]) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = el("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", quality);
    if (data.length <= MAX_DATA) return data;
  }
  throw new Error("That picture is too big to send");
}

export function createChat({ post, myId, avatarFor, toast }) {
  const seen = new Set();
  let unread = 0;
  let pending = null;
  const list = $("chat-list");
  const input = $("chat-input");

  const isOpen = () => !$("room").classList.contains("chat-closed");
  function paintBadge() {
    const badge = $("chat-badge");
    badge.hidden = unread === 0;
    badge.textContent = unread > 9 ? "9+" : String(unread);
    $("chat-button").setAttribute("aria-label", unread ? `Chat, ${unread} new` : "Chat");
  }
  function setOpen(open) {
    $("room").classList.toggle("chat-closed", !open);
    $("chat-button").setAttribute("aria-pressed", String(open));
    if (open) {
      unread = 0;
      paintBadge();
      list.scrollTop = list.scrollHeight;
      if (matchMedia("(hover: hover)").matches) input.focus();
    }
    dispatchEvent(new Event("resize"));
  }

  function paintPending() {
    const box = $("chat-attachment");
    box.replaceChildren();
    box.hidden = !pending;
    if (!pending) return;
    const img = el("img");
    img.src = pending;
    img.alt = "Picture to send";
    const remove = el("button", "chat-remove", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => ((pending = null), paintPending()));
    box.append(img, remove);
  }
  async function attach(file) {
    if (!file?.type.startsWith("image/")) return;
    try {
      pending = await shrink(file);
      paintPending();
      input.focus();
    } catch (error) {
      toast(error.message);
    }
  }

  function send() {
    const text = input.value.trim();
    if (!text && !pending) return;
    if (!post({ text, image: pending })) return toast("Not connected yet");
    input.value = "";
    pending = null;
    paintPending();
    grow();
  }
  function grow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }

  input.addEventListener("input", grow);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });
  input.addEventListener("paste", (event) => {
    const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    attach(file);
  });
  $("chat-form").addEventListener("submit", (event) => (event.preventDefault(), send()));
  $("chat-attach").addEventListener("click", () => $("chat-file").click());
  $("chat-file").addEventListener("change", (event) => {
    attach(event.target.files?.[0]);
    event.target.value = "";
  });
  $("chat-button").addEventListener("click", () => setOpen(!isOpen()));
  $("chat-close").addEventListener("click", () => setOpen(false));
  $("chat-viewer").addEventListener("click", () => ($("chat-viewer").hidden = true));

  return {
    receive(message, history = false) {
      if (!message || seen.has(message.id)) return;
      seen.add(message.id);
      const mine = message.from === myId();
      const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
      const row = el("div", mine ? "chat-msg mine" : "chat-msg");
      const avatar = el("div", "chat-avatar");
      avatar.innerHTML = avatarFor(message);
      const content = el("div", "chat-content");
      const who = el("div", "chat-who");
      who.append(el("b", "", mine ? `${message.name} (you)` : message.name), el("span", "", clock(message.at)));
      content.append(who, ...body(message.text ?? ""));
      if (message.image) {
        const img = el("img", "chat-image");
        img.src = message.image;
        img.alt = `Picture from ${message.name}`;
        img.addEventListener("click", () => {
          $("chat-viewer-image").src = message.image;
          $("chat-viewer").hidden = false;
        });
        img.addEventListener("load", () => stick && (list.scrollTop = list.scrollHeight));
        content.append(img);
      }
      row.append(avatar, content);
      list.append(row);
      if (stick || mine) list.scrollTop = list.scrollHeight;
      if (!history && !mine && !isOpen()) {
        unread++;
        paintBadge();
      }
    },
    slow() {
      toast("Slow down: a few seconds between messages");
    },
    reset() {
      seen.clear();
      list.replaceChildren();
      unread = 0;
      pending = null;
      paintPending();
      paintBadge();
    },
    toggle: () => setOpen(!isOpen()),
  };
}
