import type { ConsentViewModel } from './ui-contract';

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderConsentView(model: ConsentViewModel): string {
  const { details, handle, errorCode } = model;
  const escapedHandle = escapeHtml(handle);

  const clientName = escapeHtml(details.clientName || details.clientId || 'Unknown Client');
  const clientId = escapeHtml(details.clientId || '');
  const redirectHost = escapeHtml(details.redirectHost || '');
  const clientDomain = details.clientDomain ? escapeHtml(details.clientDomain) : null;
  const redirectIsLoopback = Boolean(details.redirectIsLoopback);
  const scopes = Array.isArray(details.scope) ? details.scope : [];

  let errorHtml = '';
  if (errorCode && errorCode !== 'NONE') {
    let errorDescription = 'An error occurred during authorization. Please try again.';
    if (errorCode === 'EXPIRED') {
      errorDescription = 'The authorization request or pairing proof has expired. Please initiate connection again from Video Scissors.';
    } else if (errorCode === 'PROOF_REJECTED') {
      errorDescription = 'The pairing proof was rejected or invalid. Please check the proof code in Video Scissors and try again.';
    }
    errorHtml = `
      <div class="alert alert-error" role="alert">
        <div class="alert-title">Authorization Error (${escapeHtml(errorCode)})</div>
        <div class="alert-desc">${escapeHtml(errorDescription)}</div>
      </div>
    `;
  }

  let domainHtml = '';
  if (clientDomain) {
    domainHtml = `
      <div class="banner banner-verified">
        <span class="banner-icon">&#x2713;</span>
        <span>Verified client domain: <strong>${clientDomain}</strong></span>
      </div>
    `;
  } else {
    domainHtml = `
      <div class="banner banner-warning">
        <span class="banner-icon">&#x26A0;</span>
        <span><strong>Warning:</strong> Client name &ldquo;${clientName}&rdquo; is self-asserted and unverified.</span>
      </div>
    `;
  }

  let loopbackHtml = '';
  if (redirectIsLoopback) {
    loopbackHtml = `
      <div class="banner banner-warning">
        <span class="banner-icon">&#x26A0;</span>
        <span><strong>Local App Warning:</strong> The redirect destination (${redirectHost}) is a local loopback address. Any application running locally on your computer could potentially listen on this address.</span>
      </div>
    `;
  }

  const scopesHtml = scopes.length > 0
    ? scopes.map(s => `
        <label class="scope-checkbox-label">
          <input type="checkbox" name="scope" value="${escapeHtml(s)}" checked />
          <code>${escapeHtml(s)}</code>
        </label>
      `).join('\n')
    : '<div class="text-muted">No specific scopes requested.</div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize Video Scissors Remote Control</title>
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #f4f4f5;
      color: #18181b;
      line-height: 1.5;
      padding: 24px 16px;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      min-height: 100vh;
    }
    .card {
      background-color: #ffffff;
      border: 1px solid #e4e4e7;
      border-radius: 16px;
      padding: 24px;
      max-width: 520px;
      width: 100%;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
    }
    .header {
      margin-bottom: 20px;
    }
    .header h1 {
      font-size: 1.25rem;
      font-weight: 700;
      color: #09090b;
      margin-bottom: 4px;
    }
    .header p {
      font-size: 0.875rem;
      color: #71717a;
    }
    .alert {
      padding: 12px 14px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 0.8125rem;
    }
    .alert-error {
      background-color: #fef2f2;
      border: 1px solid #fecaca;
      color: #991b1b;
    }
    .alert-title {
      font-weight: 600;
      margin-bottom: 2px;
    }
    .banner {
      padding: 10px 12px;
      border-radius: 8px;
      margin-bottom: 14px;
      font-size: 0.8125rem;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .banner-warning {
      background-color: #fffbeb;
      border: 1px solid #fde68a;
      color: #92400e;
    }
    .banner-verified {
      background-color: #f0fdf4;
      border: 1px solid #bbf7d0;
      color: #166534;
    }
    .banner-icon {
      font-weight: bold;
      flex-shrink: 0;
    }
    .details-table {
      background-color: #fafafa;
      border: 1px solid #f4f4f5;
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 18px;
      font-size: 0.8125rem;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 4px 0;
      border-bottom: 1px solid #f4f4f5;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      color: #71717a;
      font-weight: 500;
      margin-right: 8px;
    }
    .detail-value {
      color: #18181b;
      word-break: break-all;
      text-align: right;
    }
    .highlight-host {
      font-size: 0.875rem;
      color: #c2410c;
      font-weight: 700;
    }
    .section-title {
      font-size: 0.8125rem;
      font-weight: 600;
      color: #27272a;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }
    .scopes-container {
      margin-bottom: 18px;
      padding: 10px 12px;
      border: 1px solid #e4e4e7;
      border-radius: 8px;
      background-color: #fafafa;
    }
    .scope-checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 0.8125rem;
      cursor: pointer;
    }
    .scope-checkbox-label code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.75rem;
      background-color: #f4f4f5;
      padding: 2px 6px;
      border-radius: 4px;
      color: #3f3f46;
    }
    .form-group {
      margin-bottom: 18px;
    }
    .form-label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 600;
      color: #18181b;
      margin-bottom: 4px;
    }
    .form-hint {
      font-size: 0.75rem;
      color: #71717a;
      margin-bottom: 8px;
    }
    .input-text {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #d4d4d8;
      border-radius: 8px;
      font-size: 0.875rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background-color: #ffffff;
      color: #18181b;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .input-text:focus {
      border-color: #ea580c;
      box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.15);
    }
    .disclosures {
      background-color: #f4f4f5;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 20px;
      font-size: 0.75rem;
      color: #52525b;
      line-height: 1.45;
    }
    .disclosures ul {
      padding-left: 18px;
      margin-top: 4px;
    }
    .disclosures li {
      margin-bottom: 4px;
    }
    .disclosures li:last-child {
      margin-bottom: 0;
    }
    .button-group {
      display: flex;
      gap: 12px;
      margin-top: 20px;
    }
    .btn {
      flex: 1;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      transition: background-color 0.15s ease, opacity 0.15s ease;
      border: none;
    }
    .btn-primary {
      background-color: #ea580c;
      color: #ffffff;
    }
    .btn-primary:hover {
      background-color: #c2410c;
    }
    .btn-secondary {
      background-color: #ffffff;
      color: #3f3f46;
      border: 1px solid #d4d4d8;
    }
    .btn-secondary:hover {
      background-color: #f4f4f5;
    }
    .text-muted {
      font-size: 0.8125rem;
      color: #a1a1aa;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Authorize Remote Control</h1>
      <p>An application is requesting remote control access to your local Video Scissors session.</p>
    </div>

    ${errorHtml}

    ${domainHtml}

    ${loopbackHtml}

    <div class="details-table">
      <div class="detail-row">
        <span class="detail-label">Client Name:</span>
        <span class="detail-value"><strong>${clientName}</strong></span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Client ID:</span>
        <span class="detail-value font-mono"><code>${clientId}</code></span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Redirect Host:</span>
        <span class="detail-value highlight-host">${redirectHost}</span>
      </div>
    </div>

    <form method="POST" action="/authorize">
      <input type="hidden" name="handle" value="${escapedHandle}" />

      <div class="section-title">Requested Scopes</div>
      <div class="scopes-container">
        ${scopesHtml}
      </div>

      <div class="form-group">
        <label for="browserProof" class="form-label">One-Time Browser Pairing Proof</label>
        <div class="form-hint">Required for approval only. Copy the one-time proof code shown in your local Video Scissors tab.</div>
        <input
          type="text"
          id="browserProof"
          name="browserProof"
          class="input-text"
          autocomplete="off"
          spellcheck="false"
          placeholder="Enter pairing proof code"
          required
        />
      </div>

      <div class="disclosures">
        <strong>Session &amp; Security Disclosures:</strong>
        <ul>
          <li><strong>Media-local control only:</strong> Video source footage, decoded frames, and audio remain strictly local to your browser tab. The remote connection provides editing control commands only; raw video media is never transmitted or stored remotely.</li>
          <li><strong>30-minute finite session:</strong> Authorized connection sessions automatically expire after 30 minutes.</li>
          <li><strong>Revocation notice:</strong> Revoking access terminates future commands, but cannot reverse already-dispatched work.</li>
        </ul>
      </div>

      <div class="button-group">
        <button type="submit" name="decision" value="deny" formnovalidate class="btn btn-secondary">Deny</button>
        <button type="submit" name="decision" value="approve" class="btn btn-primary">Approve</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}
