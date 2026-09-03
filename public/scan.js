(function () {
  const STORAGE_KEY = "relief_api_key";

  function getApiKey() {
    let key = localStorage.getItem(STORAGE_KEY);
    if (!key) {
      key = prompt("Admin API key (from /api/me):");
      if (key) localStorage.setItem(STORAGE_KEY, key.trim());
    }
    return key ? key.trim() : null;
  }

  function buildUI(container) {
    container.innerHTML = `
      <progress id="scan-bar" value="0" max="1" style="width:100%;display:none;"></progress>
      <div id="scan-stats" style="display:none;font-size:0.8rem;opacity:0.8;margin-top:0.35rem;">
        scanned <b id="scan-scanned">0</b> · added <b id="scan-added">0</b> · updated <b id="scan-updated">0</b> · errors <b id="scan-errors">0</b>
      </div>
      <div id="scan-log" style="font-family:ui-monospace,monospace;font-size:0.75rem;white-space:pre-wrap;max-height:140px;overflow-y:auto;margin-top:0.5rem;"></div>
    `;
  }

  function log(container, text) {
    const el = container.querySelector("#scan-log");
    el.textContent += text + "\n";
    el.scrollTop = el.scrollHeight;
  }

  async function runScan(container, btn) {
    const apiKey = getApiKey();
    if (!apiKey) return;

    btn.disabled = true;
    const bar = container.querySelector("#scan-bar");
    const stats = container.querySelector("#scan-stats");
    bar.style.display = stats.style.display = "block";
    bar.removeAttribute("value"); // indeterminate until the first step reports in
    container.querySelector("#scan-log").textContent = "";

    try {
      const startRes = await fetch(`/api/reconcile/start?apiKey=${encodeURIComponent(apiKey)}`, { method: "POST" });
      const startData = await startRes.json();
      if (!startData.ok) throw new Error(startData.error || "Failed to start scan");
      log(container, `Started job ${startData.jobId}`);

      let done = false;
      while (!done) {
        const stepRes = await fetch(`/api/reconcile/step?jobId=${startData.jobId}&apiKey=${encodeURIComponent(apiKey)}`, {
          method: "POST",
        });
        const data = await stepRes.json();
        if (!data.ok) throw new Error(data.error || "Scan step failed");

        container.querySelector("#scan-scanned").textContent = data.scanned;
        container.querySelector("#scan-added").textContent = data.added;
        container.querySelector("#scan-updated").textContent = data.updated;
        container.querySelector("#scan-errors").textContent = data.errors;
        if (data.lastError) log(container, `⚠ ${data.lastError}`);
        done = data.done;
      }

      bar.value = 1;
      bar.max = 1;
      log(container, "Done.");
    } catch (err) {
      log(container, `✗ ${err.message || err}`);
      // A bad/expired key would surface as a 403 from the admin-gated routes — clear it so the next click re-prompts.
      if (String(err.message || "").toLowerCase().includes("admin")) {
        localStorage.removeItem(STORAGE_KEY);
      }
    } finally {
      btn.disabled = false;
    }
  }

  function init() {
    const btn = document.getElementById("scan-media-btn");
    if (!btn) return; // page doesn't have the button — nothing to attach to

    let container = document.getElementById("scan-media-status");
    if (!container) {
      container = document.createElement("div");
      container.id = "scan-media-status";
      btn.insertAdjacentElement("afterend", container);
    }
    buildUI(container);
    btn.addEventListener("click", () => runScan(container, btn));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
