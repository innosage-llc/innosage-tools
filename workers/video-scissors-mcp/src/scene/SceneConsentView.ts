import type { SceneConsentModel } from '../../../../lib/visual-remix-sharing-view';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderSceneConsentView(model: SceneConsentModel): string {
  const safeHandle = escapeHtml(model.handle);
  const safeClientName = escapeHtml(model.clientName);
  const safeClientId = escapeHtml(model.clientId);
  const safeRedirectHost = escapeHtml(model.redirectHost);
  const referenceEnabled = Boolean(model.referenceEnabled);
  const untilRevokedEnabled = Boolean(model.untilRevokedEnabled);

  const loopbackWarning = model.isLoopback
    ? `<div class="alert-warning" role="alert">
        <strong>Notice:</strong> The redirect destination (<code>${safeRedirectHost}</code>) is a local loopback address. Verify that this client was started locally on your machine.
      </div>`
    : '';

  const reauth = model.reauthorization;
  const safeNonce = reauth ? escapeHtml(reauth.scriptNonce) : '';

  const reauthUnavailableNotice = model.reauthorizationUnavailable
    ? `<div class="alert-warning" role="alert">
        <strong>Notice:</strong> Reconnect request storage is temporarily busy. Keep your original editor active and enter pairing proof manually from that editor to authorize, or try again later.
      </div>`
    : '';

  const reauthStyles = reauth
    ? `
    .reconnect-section {
      background-color: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 16px;
      font-size: 0.875rem;
    }
    .reconnect-section h2 {
      font-size: 0.875rem;
      font-weight: 600;
      color: #166534;
      margin-bottom: 6px;
    }
    .reconnect-section p {
      color: #15803d;
      font-size: 0.8125rem;
      margin-bottom: 8px;
    }
    .reauth-status {
      font-size: 0.8125rem;
      font-weight: 500;
      color: #166534;
      background-color: #ffffff;
      border: 1px solid #86efac;
      border-radius: 4px;
      padding: 6px 10px;
      margin-bottom: 8px;
    }
    .btn-secondary {
      background-color: #ffffff;
      color: #166534;
      border: 1px solid #86efac;
      padding: 6px 12px;
      font-size: 0.75rem;
      font-weight: 500;
      border-radius: 4px;
      cursor: pointer;
    }
    .btn-secondary:hover {
      background-color: #f0fdf4;
    }`
    : '';

  const reauthSection = reauth
    ? `<section class="reconnect-section" aria-label="Reconnect an active Scene share">
      <h2>Reconnect an active Scene share</h2>
      <p>Keep your original Visual Remix editor active in another tab or window. In that editor, approve reconnecting <strong>${safeClientName}</strong>. Once approved, the pairing proof will fill automatically below. Then finish authorization by clicking Approve.</p>
      <div id="reauth-status" class="reauth-status" role="status" aria-live="polite">Waiting for approval from active editor…</div>
      <button type="button" id="reauth-retry-btn" class="btn-secondary">Ask active editor again</button>
    </section>`
    : '';

  const reauthHiddenInput = reauth
    ? `\n      <input type="hidden" name="reauthRequestId" id="reauthRequestId" value="">`
    : '';

  const reauthScript = reauth
    ? `\n  <script nonce="${safeNonce}">
(function() {
  var config = ${JSON.stringify({
    requestId: reauth.requestId,
    channelName: 'visual-remix-reauthorization-v1',
  }).replace(/</g, '\\u003c')};

  var proofInput = document.getElementById('browserProof');
  var reauthInput = document.getElementById('reauthRequestId');
  var statusEl = document.getElementById('reauth-status');
  var retryBtn = document.getElementById('reauth-retry-btn');

  if (proofInput && reauthInput) {
    proofInput.addEventListener('input', function() {
      reauthInput.value = '';
    });
  }

  if (!('BroadcastChannel' in window)) {
    if (statusEl) {
      statusEl.textContent = 'Automatic reconnection is not supported in this browser. Keep your active editor open and enter pairing proof manually.';
    }
    if (retryBtn) {
      retryBtn.disabled = true;
    }
    return;
  }

  var channel = null;
  var timers = [];
  var isClosed = false;
  var proofReceived = false;
  var startTime = performance.now();
  var TIMEOUT_MS = 300000;

  function cleanup() {
    if (isClosed) return;
    isClosed = true;
    for (var i = 0; i < timers.length; i++) {
      clearTimeout(timers[i]);
    }
    timers = [];
    if (channel) {
      try {
        channel.close();
      } catch (e) {}
      channel = null;
    }
  }

  window.addEventListener('pagehide', cleanup);

  var expiryTimer = setTimeout(function() {
    cleanup();
    if (!proofReceived && statusEl) {
      statusEl.textContent = 'Reconnect request timed out after 5 minutes. Enter pairing proof manually from your active editor.';
    }
  }, TIMEOUT_MS);
  timers.push(expiryTimer);

  try {
    channel = new BroadcastChannel(config.channelName);
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = 'Unable to connect to editor BroadcastChannel. Enter pairing proof manually.';
    }
    return;
  }

  function announce() {
    if (isClosed || !channel || proofReceived) return;
    if (performance.now() - startTime >= TIMEOUT_MS) {
      cleanup();
      return;
    }
    try {
      channel.postMessage({
        type: 'scene-reauth-request',
        requestId: config.requestId
      });
    } catch (err) {}
  }

  channel.onmessage = function(event) {
    if (isClosed || proofReceived) return;
    if (performance.now() - startTime >= TIMEOUT_MS) {
      cleanup();
      return;
    }
    var data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;

    var keys = Object.keys(data);
    if (keys.length !== 3) return;
    var hasType = false, hasReq = false, hasProof = false;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === 'type') hasType = true;
      else if (keys[i] === 'requestId') hasReq = true;
      else if (keys[i] === 'proof') hasProof = true;
      else return;
    }
    if (!hasType || !hasReq || !hasProof) return;

    if (typeof data.type !== 'string' || typeof data.requestId !== 'string' || typeof data.proof !== 'string') return;
    if (data.type.length > 32 || data.requestId.length > 128 || data.proof.length !== 64) return;
    if (data.type !== 'scene-reauth-proof') return;
    if (data.requestId !== config.requestId) return;
    if (!/^[0-9a-f]{64}$/.test(data.proof)) return;

    proofReceived = true;
    if (proofInput) {
      proofInput.value = data.proof;
    }
    if (reauthInput) {
      reauthInput.value = data.requestId;
    }
    if (statusEl) {
      statusEl.textContent = 'Proof received from active editor. Click Approve below to complete authorization.';
    }
  };

  announce();
  timers.push(setTimeout(announce, 1000));
  timers.push(setTimeout(announce, 3000));

  if (retryBtn) {
    retryBtn.addEventListener('click', function() {
      if (isClosed || proofReceived) return;
      announce();
      if (statusEl && !proofReceived) {
        statusEl.textContent = 'Re-sent reconnect request to active editor…';
      }
    });
  }
})();
</script>`
    : '';

  const descriptionText = untilRevokedEnabled
    ? referenceEnabled
      ? 'This explicitly authorizes Visual Remix Scene sharing, not video control. Text, layout, style, captions, provenance, limitations, and used raster descriptors are shared; original images and exports stay in your browser unless a normalized reference copy is separately approved in the paired editor. Dual duration policy: newly explicitly consented shares run until you Disconnect or revoke in the browser, while existing timed shares keep their original fixed deadline (up to 30 minutes) with no silent upgrade. No model or social-platform credentials are requested.'
      : 'This explicitly authorizes Visual Remix Scene sharing, not video control. Text, layout, style, captions, provenance, limitations, and used raster descriptors are shared; original images and exports stay in your browser. Dual duration policy: newly explicitly consented shares run until you Disconnect or revoke in the browser, while existing timed shares keep their original fixed deadline (up to 30 minutes) with no silent upgrade. No model or social-platform credentials are requested.'
    : referenceEnabled
    ? 'This explicitly authorizes Visual Remix Scene sharing, not video control. Text, layout, style, captions, provenance, limitations, and used raster descriptors are shared; original images and exports stay in your browser unless a normalized reference copy is separately approved in the paired editor. No model or social-platform credentials are requested.'
    : 'This explicitly authorizes Visual Remix Scene sharing, not video control. Text, layout, style, captions, provenance, limitations, and used raster descriptors are shared; original images and exports stay in your browser. No model or social-platform credentials are requested.';

  const disclosuresList = untilRevokedEnabled
    ? referenceEnabled
      ? `<li><strong>Scope:</strong> Text, layout, style, captions, provenance, limitations, and used raster descriptors are shared. Reference images may be shared ONLY if separately approved in the paired editor. Without pixel consent, original images and exports remain local. Optional reference sharing sends a size-limited PNG derivative (at most 1 MiB and 2048 pixels on the longest side), not original file metadata. Shared original remains local for exact crops. No model or social-platform credentials are requested.</li>
        <li><strong>Permissions:</strong> The agent may READ and propose previews only; user Apply approves candidate and included crop assets once. Local parameter edits apply automatically with Undo; actual applied and export safety remain unaffected. Apply and export actions remain browser-owned.</li>
        <li><strong>Pairing Proof:</strong> The pairing proof comes from your current Visual Remix browser tab and is one-use/five-minute. Opening this page or connecting does not authorize sharing automatically.</li>
        <li><strong>Duration (Dual Policy):</strong> Sharing lifetime follows the consent given in the paired editor. For newly explicitly consented until-revoked sessions, remote access remains authorized until you Disconnect or revoke in the browser, with browser control remembered on that device (clearing site data loses recovery). For existing timed sessions, sharing expires at its original fixed deadline of up to 30 minutes (or 15 minutes) with no silent renewal, no heartbeat extension, and no silent upgrade. Pairing is single-use and valid for 5 minutes. OAuth and platform authorization remain finite and can still expire; browser must stay available (until-revoked is sharing authorization, not a guaranteed always-connected host; no public links, new scopes, or credentials). Expiry or revocation blocks remote access immediately; local Scene data and editing survive.</li>
        <li><strong>Storage &amp; Retention (Dual Policy):</strong> For until-revoked shares, the service caches shared Scene text/layout and explicitly approved reference PNG derivative; inactive cache is eligible for cleanup after 30 minutes without browser sync; scheduled cleanup, backlog, or provider failures can delay deletion. Revoke removes current service payloads; backups (which may retain data up to 7 days) and already-delivered ChatGPT conversation content cannot be recalled (immediate or guaranteed timed physical erasure is not promised). For existing timed shares, shared content is stored during the nonrenewable share (up to 30 minutes fixed deadline); revoke removes active reference payload, expiry blocks access immediately with lazy cleanup, and backups may retain data up to 7 days. In either mode, there is no public URL.</li>
        <li><strong>Image Processing:</strong> Remote model processing may occur only on explicitly authorized reference derivatives. No unauthorized source image analysis is performed by this page.</li>`
      : `<li><strong>Scope:</strong> Text, layout, style, captions, provenance, limitations, and used raster descriptors are shared. Original images and exports stay in your browser. No model or social-platform credentials are requested.</li>
        <li><strong>Permissions:</strong> The agent may READ and propose previews only; Apply and export actions remain browser-owned.</li>
        <li><strong>Pairing Proof:</strong> The pairing proof comes from your current Visual Remix browser tab and is one-use/five-minute. Opening this page or connecting does not authorize sharing automatically.</li>
        <li><strong>Duration (Dual Policy):</strong> Sharing lifetime follows the consent given in the paired editor. For newly explicitly consented until-revoked sessions, remote access remains authorized until you Disconnect or revoke in the browser, with browser control remembered on that device (clearing site data loses recovery). For existing timed sessions, sharing expires at its original fixed deadline of up to 30 minutes (or 15 minutes) with no silent renewal, no heartbeat extension, and no silent upgrade. Pairing is single-use and valid for 5 minutes. OAuth and platform authorization remain finite and can still expire; browser must stay available (until-revoked is sharing authorization, not a guaranteed always-connected host; no public links, new scopes, or credentials). Expiry or revocation blocks remote access immediately; local Scene data and editing survive.</li>
        <li><strong>Storage &amp; Retention (Dual Policy):</strong> For until-revoked shares, the service caches shared Scene text/layout; inactive cache is eligible for cleanup after 30 minutes without browser sync; scheduled cleanup, backlog, or provider failures can delay deletion. Revoke removes current service payloads; backups (which may retain data up to 7 days) and already-delivered ChatGPT conversation content cannot be recalled (immediate or guaranteed timed physical erasure is not promised). For existing timed shares, shared content is stored during the nonrenewable share (up to 30 minutes fixed deadline); revoke removes current payloads, expiry cleanup is lazy, and backups may retain data up to 7 days. In either mode, there is no public URL.</li>
        <li><strong>Image Processing:</strong> No source image analysis is performed by this page.</li>`
    : referenceEnabled
    ? `<li><strong>Scope:</strong> Text, layout, style, captions, provenance, limitations, and used raster descriptors are shared. Reference images may be shared ONLY if separately approved in the paired editor. Without pixel consent, original images and exports remain local. Optional reference sharing sends a size-limited PNG derivative (at most 1 MiB and 2048 pixels on the longest side), not original file metadata. Shared original remains local for exact crops. No model or social-platform credentials are requested.</li>
        <li><strong>Permissions:</strong> The agent may READ and propose previews only; user Apply approves candidate and included crop assets once. Local parameter edits apply automatically with Undo; actual applied and export safety remain unaffected. Apply and export actions remain browser-owned.</li>
        <li><strong>Pairing Proof:</strong> The pairing proof comes from your current Visual Remix browser tab and is one-use/five-minute. Opening this page or connecting does not authorize sharing automatically.</li>
        <li><strong>Duration:</strong> Share expires at a fixed deadline of up to 30 minutes selected in the browser (existing shorter leases remain unchanged); no silent renewal or heartbeat extension is provided, and no persistent grant is created. Expiry blocks remote access immediately, while local Scene data and editing survive.</li>
        <li><strong>Storage &amp; Retention:</strong> Shared text/layout and explicitly approved reference PNG are stored in existing private service D1 during the nonrenewable share (up to 30 minutes fixed deadline); no public URL. Revoke removes active reference payload; expiry blocks access immediately but cleanup is lazy. Cloudflare Free backups can retain up to 7 days, and already delivered ChatGPT conversation content cannot be retracted.</li>
        <li><strong>Image Processing:</strong> Remote model processing may occur only on explicitly authorized reference derivatives. No unauthorized source image analysis is performed by this page.</li>`
    : `<li><strong>Scope:</strong> Text, layout, style, captions, provenance, limitations, and used raster descriptors are shared. Original images and exports stay in your browser. No model or social-platform credentials are requested.</li>
        <li><strong>Permissions:</strong> The agent may READ and propose previews only; Apply and export actions remain browser-owned.</li>
        <li><strong>Pairing Proof:</strong> The pairing proof comes from your current Visual Remix browser tab and is one-use/five-minute.</li>
        <li><strong>Duration:</strong> Share expires at a fixed deadline of up to 30 minutes selected in the browser (existing shorter leases remain unchanged); no silent renewal or heartbeat extension is provided, and no persistent grant is created. Expiry blocks remote access immediately, while local Scene data and editing survive.</li>
        <li><strong>Storage &amp; Retention:</strong> Shared text/layout is stored by the service during the nonrenewable share (up to 30 minutes fixed deadline); revoke removes current payloads; expiry cleanup is lazy and data can remain until cleanup. Remote model processing may occur; automatic physical deletion is not guaranteed.</li>
        <li><strong>Image Processing:</strong> No source image analysis is performed by this page.</li>`;

  const readScopeDescription = referenceEnabled
    ? '<code>scene:read</code> &mdash; Read scene text, layout, style, captions, provenance, limitations, and used raster descriptors (may include explicitly shared reference if enabled and approved in the paired editor)'
    : '<code>scene:read</code> &mdash; Read scene text, layout, style, captions, provenance, limitations, and used raster descriptors';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize Scene Sharing - Visual Remix</title>
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #f3f4f6;
      color: #1f2937;
      line-height: 1.5;
      padding: 24px 16px;
    }
    .container {
      max-width: 560px;
      margin: 0 auto;
      background-color: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
      padding: 24px;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      color: #111827;
      margin-bottom: 12px;
    }
    .description {
      font-size: 0.875rem;
      color: #4b5563;
      margin-bottom: 16px;
    }
    .client-details {
      background-color: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 16px;
      font-size: 0.875rem;
    }
    .client-details dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 12px;
    }
    .client-details dt {
      font-weight: 500;
      color: #6b7280;
    }
    .client-details dd {
      color: #111827;
      word-break: break-all;
    }
    .alert-warning {
      background-color: #fffbeb;
      border: 1px solid #fef3c7;
      color: #92400e;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 16px;
      font-size: 0.875rem;
    }
    .disclosure-box {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 20px;
      background-color: #ffffff;
      font-size: 0.8125rem;
      color: #374151;
    }
    .disclosure-box h2 {
      font-size: 0.875rem;
      font-weight: 600;
      margin-bottom: 8px;
      color: #111827;
    }
    .disclosure-box ul {
      padding-left: 20px;
      margin-bottom: 8px;
    }
    .disclosure-box li {
      margin-bottom: 4px;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .scope-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .scope-label {
      font-size: 0.875rem;
      font-weight: 600;
      color: #111827;
    }
    .checkbox-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 0.875rem;
    }
    .checkbox-item input[type="checkbox"] {
      margin-top: 3px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-group label {
      font-size: 0.875rem;
      font-weight: 500;
      color: #374151;
    }
    .input-text {
      width: 100%;
      padding: 8px 12px;
      font-size: 0.875rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      color: #111827;
    }
    .input-text:focus-visible,
    input[type="checkbox"]:focus-visible,
    button:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }
    .input-help {
      font-size: 0.75rem;
      color: #6b7280;
    }
    .button-group {
      display: flex;
      gap: 12px;
      margin-top: 8px;
    }
    .btn {
      flex: 1;
      padding: 10px 16px;
      font-size: 0.875rem;
      font-weight: 500;
      border-radius: 6px;
      text-align: center;
      cursor: pointer;
      border: 1px solid transparent;
    }
    .btn-approve {
      background-color: #2563eb;
      color: #ffffff;
      border-color: #2563eb;
    }
    .btn-approve:hover {
      background-color: #1d4ed8;
    }
    .btn-deny {
      background-color: #ffffff;
      color: #374151;
      border-color: #d1d5db;
    }
    .btn-deny:hover {
      background-color: #f9fafb;
    }
    .inactive-notice {
      margin-top: 16px;
      font-size: 0.75rem;
      color: #6b7280;
      text-align: center;
    }${reauthStyles}
  </style>
</head>
<body>
  <main class="container">
    <h1>Authorize Scene Sharing</h1>
    <p class="description">
      ${descriptionText}
    </p>

    <section class="client-details" aria-label="Client Details">
      <dl>
        <dt>Application:</dt>
        <dd>${safeClientName}</dd>
        <dt>Client ID:</dt>
        <dd><code>${safeClientId}</code></dd>
        <dt>Redirect Host:</dt>
        <dd><code>${safeRedirectHost}</code></dd>
      </dl>
    </section>

    ${loopbackWarning}${reauthUnavailableNotice ? `\n\n    ${reauthUnavailableNotice}` : ''}

    <section class="disclosure-box" aria-label="Permissions and Data Disclosures">
      <h2>Sharing Scope and Data Disclosures</h2>
      <ul>
        ${disclosuresList}
      </ul>
    </section>${reauthSection ? `\n\n    ${reauthSection}` : ''}

    <form method="POST" action="/authorize">
      <input type="hidden" name="handle" value="${safeHandle}">${reauthHiddenInput}

      <div class="scope-group">
        <span class="scope-label">Requested Scopes</span>
        <div class="checkbox-item">
          <input type="checkbox" id="scope-read" name="scope" value="scene:read" checked>
          <label for="scope-read">${readScopeDescription}</label>
        </div>
        <div class="checkbox-item">
          <input type="checkbox" id="scope-propose" name="scope" value="scene:propose" checked>
          <label for="scope-propose"><code>scene:propose</code> &mdash; Propose preview modifications only</label>
        </div>
      </div>

      <div class="form-group">
        <label for="browserProof">Pairing Proof (from current Visual Remix tab)</label>
        <input type="text" id="browserProof" name="browserProof" required autocomplete="off" class="input-text" placeholder="Enter one-use 5-minute proof">
        <span class="input-help">Single-use proof valid for 5 minutes from your current Visual Remix browser tab.</span>
      </div>

      <div class="button-group">
        <button type="submit" name="decision" value="deny" formnovalidate class="btn btn-deny">Deny</button>
        <button type="submit" name="decision" value="approve" class="btn btn-approve">Approve</button>
      </div>
    </form>

    <p class="inactive-notice">
      Opening this page does not authorize sharing. Only Approve with a valid pairing proof grants access.
    </p>
  </main>${reauthScript}
</body>
</html>`;
}
