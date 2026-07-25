(() => {
  const reveal = (reason) => {
    const overlay = document.getElementById("boot-error");
    if (!overlay || window.__towerforgeBootOk) return;
    const message = document.getElementById("boot-error-message");
    if (message && reason) message.textContent = String(reason);
    overlay.hidden = false;
    document.getElementById("boot-reload").onclick = () => location.reload();
    document.getElementById("boot-reset").onclick = () => {
      try {
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
          const key = localStorage.key(i) || "";
          if (key === "towerforge:progress:local.towerforge.starter" || key.startsWith("story_seen_local.towerforge.starter:")) localStorage.removeItem(key);
        }
      } catch {}
      location.reload();
    };
    document.getElementById("boot-reload").focus();
  };
  window.addEventListener("error", (event) => reveal(event.error?.message || event.message));
  window.addEventListener("unhandledrejection", (event) => reveal(event.reason?.message || event.reason || "The game failed while starting."));
  setTimeout(() => reveal("The game did not finish starting."), 5000);
})();
