(function () {
  const svg = document.getElementById("flowSvg");
  FlowDiagram.build(svg);

  const methodEl = document.getElementById("method");
  const simulateEl = document.getElementById("simulate");
  const payloadPreview = document.getElementById("payloadPreview");
  const sendBtn = document.getElementById("sendBtn");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const flowCaption = document.getElementById("flowCaption");
  const responseBody = document.getElementById("responseBody");
  const responseMeta = document.getElementById("responseMeta");
  const logConsole = document.getElementById("logConsole");
  const tokenDisplay = document.getElementById("tokenDisplay");
  const getTokenBtn = document.getElementById("getTokenBtn");
  const idemField = document.getElementById("idemField");
  const idemDisplay = document.getElementById("idemDisplay");
  const newIdemBtn = document.getElementById("newIdemBtn");
  const modeBanner = document.getElementById("modeBanner");

  let currentToken = null;
  let currentIdemKey = null;
  const seenIdempotencyKeys = new Set();

  function newKey() {
    return "idem_" + Math.random().toString(36).slice(2, 10);
  }
  currentIdemKey = newKey();
  idemDisplay.textContent = currentIdemKey;

  newIdemBtn.addEventListener("click", () => {
    currentIdemKey = newKey();
    idemDisplay.textContent = currentIdemKey;
  });

  function syncIdemFieldVisibility() {
    idemField.style.display = methodEl.value === "POST" ? "block" : "none";
  }
  methodEl.addEventListener("change", () => { syncIdemFieldVisibility(); refreshPayload(); });
  syncIdemFieldVisibility();

  // ---------------- backend availability banner ----------------
  ApiClient.checkBackend().then((isLive) => {
    modeBanner.hidden = false;
    if (isLive) {
      modeBanner.textContent = `Connected to live backend at ${ApiClient.BASE_URL}`;
      modeBanner.classList.add("live");
    } else {
      modeBanner.textContent = `Backend not running at ${ApiClient.BASE_URL} — showing realistic mock responses instead. Run the FastAPI server (see backend/) for the live version.`;
    }
  });

  // ---------------- token ----------------
  getTokenBtn.addEventListener("click", async () => {
    getTokenBtn.disabled = true;
    getTokenBtn.textContent = "…";
    const r = await ApiClient.fetchToken();
    currentToken = r.body && r.body.access_token;
    tokenDisplay.textContent = currentToken
      ? currentToken.slice(0, 18) + "…" + (r.live ? "" : " (mock)")
      : "Failed to get token";
    getTokenBtn.disabled = false;
    getTokenBtn.textContent = "Refresh";
    addLog(`Fetched a Bearer token${r.live ? "" : " (mock — backend offline)"}`, "pulse");
  });

  // ---------------- payload preview ----------------
  const PAYLOADS = {
    GET: { user_id: 42 },
    POST: { name: "Alex Rivera", email: "alex@example.com" },
  };
  function refreshPayload() {
    payloadPreview.innerHTML = formatJson(PAYLOADS[methodEl.value] || {});
  }
  refreshPayload();

  function formatJson(obj) {
    const json = JSON.stringify(obj, null, 2);
    return json
      .replace(/"([^"]+)":/g, '<span class="k">"$1"</span>:')
      .replace(/: "([^"]*)"/g, ': <span class="s">"$1"</span>')
      .replace(/: (-?\d+(\.\d+)?)/g, ': <span class="n">$1</span>')
      .replace(/: (true|false)/g, ': <span class="b">$1</span>');
  }

  function addLog(text, dotClass) {
    if (logConsole.querySelector(".log-empty")) logConsole.innerHTML = "";
    const time = new Date().toTimeString().slice(0, 8);
    const line = document.createElement("div");
    line.className = "log-line";
    line.innerHTML = `<span class="log-time">${time}</span><span class="log-dot ${dotClass || ""}"></span><span>${text}</span>`;
    logConsole.appendChild(line);
    logConsole.scrollTop = logConsole.scrollHeight;
  }

  // ---------------- send request ----------------
  async function runRequest() {
    sendBtn.disabled = true;
    FlowDiagram.resetVisualState();
    responseBody.classList.add("empty");
    responseBody.textContent = "Waiting for the round trip to finish…";
    responseMeta.innerHTML = "";
    statusDot.className = "status-dot live";
    statusText.textContent = "Sending request…";

    const method = methodEl.value;
    const simulate = simulateEl.value;
    const idempotencyKey = method === "POST" ? currentIdemKey : null;

    addLog(
      `${method} /v1/users/42${simulate ? ` — demoing: ${simulateEl.options[simulateEl.selectedIndex].text}` : ""}`,
      "pulse"
    );

    // Where does the forward trip stop, and does it end in failure?
    // A missing token or a rate limit is rejected at the gateway (hop 1).
    // A backend crash happens one hop further in, at the service (hop 2).
    let toIndex = 3;
    let isError = false;
    if (simulate === "no-token" || simulate === "429") { toIndex = 1; isError = true; }
    else if (simulate === "500") { toIndex = 2; isError = true; }

    await FlowDiagram.animateForward({
      toIndex,
      isError,
      duration: 1600,
      onEnterNode: (idx, errored) => {
        const n = FlowDiagram.NODES[idx];
        if (errored) {
          flowCaption.textContent = `Rejected at ${n.label}`;
          addLog(`${n.label} rejected the request`, "error");
        } else if (idx > 0) {
          flowCaption.textContent = `Arrived at ${n.label}`;
          addLog(`${n.label} received the request`, "pulse");
        } else {
          flowCaption.textContent = "Leaving your app";
        }
      },
    });

    const result = await ApiClient.callUsersEndpoint(method, {
      simulate,
      idempotencyKey,
      token: currentToken,
      seenIdempotencyKeys,
    });
    if (idempotencyKey) seenIdempotencyKeys.add(idempotencyKey);

    statusText.textContent = "Sending response back…";
    const responseIsError = result.status >= 400;
    await FlowDiagram.animateBackward({
      fromIndex: toIndex,
      isError: responseIsError,
      duration: 1200,
      onEnterNode: (idx) => {
        const n = FlowDiagram.NODES[idx];
        flowCaption.textContent = idx === 0 ? "Round trip complete" : `${n.label} forwarding the response`;
      },
    });

    responseBody.classList.remove("empty");
    responseBody.innerHTML = formatJson(result.body);
    const chipClass = responseIsError ? "err" : "ok";
    responseMeta.innerHTML =
      `<span class="chip ${chipClass}">${result.status}</span>` +
      `<span class="chip">${Math.round(result.duration)} ms${result.live ? "" : " · mock"}</span>` +
      `<span class="chip">/v1/users/42</span>`;

    statusDot.className = responseIsError ? "status-dot err" : "status-dot ok";
    statusText.textContent = responseIsError ? "Request failed" : "Response received";
    addLog(
      `Response: ${result.status}${result.live ? "" : " (backend offline — mock data shown)"}`,
      responseIsError ? "error" : "ok"
    );

    sendBtn.disabled = false;
  }

  sendBtn.addEventListener("click", runRequest);
})();
