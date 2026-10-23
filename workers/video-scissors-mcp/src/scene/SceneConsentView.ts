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

  const loopbackWarning = model.isLoopback
    ? `<div class="alert-warning" role="alert">
        <strong>Notice:</strong> The redirect destination (<code>${safeRedirectHost}</code>) is a local loopback address. Verify that this client was started locally on your machine.
      </div>`
    : '';

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
    }
  </style>
</head>
<body>
  <main class="container">
    <h1>Authorize Scene Sharing</h1>
    <p class="description">
      This explicitly authorizes Visual Remix Scene sharing, not video control. Text, layout, style, captions, provenance, limitations, and used raster descriptors are shared; original images and exports stay in your browser. No model or social-platform credentials are requested.
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

    ${loopbackWarning}

    <section class="disclosure-box" aria-label="Permissions and Data Disclosures">
      <h2>Sharing Scope and Data Disclosures</h2>
      <ul>
        <li><strong>Scope:</strong> Text, layout, style, captions, provenance, limitations, and used raster descriptors are shared. Original images and exports stay in your browser. No model or social-platform credentials are requested.</li>
        <li><strong>Permissions:</strong> The agent may READ and propose previews only; Apply and export actions remain browser-owned.</li>
        <li><strong>Pairing Proof:</strong> The pairing proof comes from your current Visual Remix browser tab and is one-use/five-minute.</li>
        <li><strong>Duration:</strong> Share expires within 15 minutes; no refresh extension is provided.</li>
        <li><strong>Storage &amp; Retention:</strong> Shared text/layout is stored by the service; revoke removes current payloads; expiry cleanup is lazy and data can remain until cleanup. Remote model processing may occur; automatic physical deletion is not guaranteed.</li>
        <li><strong>Image Processing:</strong> No source image analysis is performed by this page.</li>
      </ul>
    </section>

    <form method="POST" action="/authorize">
      <input type="hidden" name="handle" value="${safeHandle}">

      <div class="scope-group">
        <span class="scope-label">Requested Scopes</span>
        <div class="checkbox-item">
          <input type="checkbox" id="scope-read" name="scope" value="scene:read" checked>
          <label for="scope-read"><code>scene:read</code> &mdash; Read scene text, layout, style, captions, provenance, limitations, and used raster descriptors</label>
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
  </main>
</body>
</html>`;
}
