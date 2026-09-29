// <acme-tip>: a small web component with an open shadow root containing a button and a status line.
class AcmeTip extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { display:block; margin-top:14px; }
        button { font:inherit; font-weight:600; padding:9px 16px; border-radius:9px; border:1px solid #b8c1cc; background:#fff; cursor:pointer; display:inline-flex; gap:8px; align-items:center; }
        svg { width:16px; height:16px; }
        p { margin:10px 0 0; color:#1f6f5c; font-weight:600; min-height:1.4em; }
      </style>
      <button id="tip-btn" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/></svg>
        <span>Show tip</span>
      </button>
      <p id="tip-text" role="status"></p>
      <label style="display:block;margin-top:10px;font-weight:600">Backup PIN
        <input id="tip-pin" type="password" placeholder="PIN" style="display:block;margin-top:4px;padding:8px 10px;border:1px solid #b8c1cc;border-radius:8px;font:inherit">
      </label>`;
    root.getElementById("tip-btn").addEventListener("click", () => {
      root.getElementById("tip-text").textContent = "Tip: press S to save your settings.";
    });
  }
}
customElements.define("acme-tip", AcmeTip);
