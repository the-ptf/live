import { NAME_KEY, cleanName, createRoom } from "./ids.js";

// The landing page's one form: a name and Start room, straight into a new room this browser hosts.
const form = document.getElementById("start");
const input = document.getElementById("name");
input.value = localStorage.getItem(NAME_KEY) ?? "";

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = cleanName(input.value);
  if (!name) {
    input.focus();
    form.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], {
      duration: 260,
    });
    return;
  }
  localStorage.setItem(NAME_KEY, name);
  form.hidden = true;
  document.getElementById("hint").hidden = true;
  document.getElementById("going").hidden = false;
  location.assign(`/r/${createRoom()}?join=1`);
});
