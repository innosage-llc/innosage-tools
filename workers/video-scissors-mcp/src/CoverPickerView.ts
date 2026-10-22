import { COVER_PRESETS, COVER_SAMPLE_TITLE } from '../../../lib/video-scissors-covers.ts';

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderCoverPicker(): string {
  const cardsHtml = COVER_PRESETS.map((preset, index) => {
    const isFirst = index === 0;
    const bgStyle = preset.colors.length === 1
      ? preset.colors[0]
      : `linear-gradient(135deg, ${preset.colors.join(', ')})`;

    const sampleTitleHtml = escapeHtml(COVER_SAMPLE_TITLE);
    const previewContent = preset.panel
      ? `<div class="cover-panel" style="background-color: ${escapeHtml(preset.panel)}; color: ${escapeHtml(preset.foreground)};"><span class="sample-text">${sampleTitleHtml}</span></div>`
      : `<div class="cover-direct" style="color: ${escapeHtml(preset.foreground)};"><span class="sample-text">${sampleTitleHtml}</span></div>`;

    return `
      <label class="preset-card ${isFirst ? 'selected' : ''}" for="preset-${escapeHtml(preset.id)}">
        <div class="card-preview" style="background: ${escapeHtml(bgStyle)};">
          ${previewContent}
        </div>
        <div class="card-footer">
          <input
            type="radio"
            id="preset-${escapeHtml(preset.id)}"
            name="coverPreset"
            value="${escapeHtml(preset.id)}"
            class="preset-radio"
            ${isFirst ? 'checked' : ''}
            disabled
          />
          <span class="preset-name">${escapeHtml(preset.name)}</span>
        </div>
      </label>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cover Preset Picker</title>
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #f8fafc;
      color: #0f172a;
      line-height: 1.5;
      padding: 16px;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    .app-shell {
      width: 100%;
      max-width: 540px;
      background-color: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 18px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .app-header {
      margin-bottom: 14px;
    }
    .app-title {
      font-size: 1.125rem;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 2px;
    }
    .app-subtitle {
      font-size: 0.8125rem;
      color: #64748b;
    }
    .app-note {
      font-size: 0.75rem;
      color: #64748b;
      margin-top: 4px;
    }
    .preset-fieldset {
      border: none;
      padding: 0;
      margin: 0 0 14px 0;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .preset-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    @media (min-width: 440px) {
      .preset-grid {
        grid-template-columns: repeat(3, 1fr);
      }
    }
    .preset-card {
      display: flex;
      flex-direction: column;
      background-color: #ffffff;
      border: 1.5px solid #e2e8f0;
      border-radius: 8px;
      padding: 6px;
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
      user-select: none;
      position: relative;
    }
    .preset-card:hover {
      border-color: #94a3b8;
    }
    .preset-card.selected,
    .preset-card:has(.preset-radio:checked) {
      border-color: #2563eb;
      background-color: #f0f7ff;
      box-shadow: 0 0 0 1px #2563eb;
    }
    .preset-radio:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }
    .preset-card:has(.preset-radio:focus-visible) {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }
    .card-preview {
      aspect-ratio: 16 / 9;
      width: 100%;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8px;
      box-sizing: border-box;
      overflow: hidden;
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
    }
    .cover-panel {
      border-radius: 4px;
      padding: 4px 6px;
      font-size: 10px;
      font-weight: 600;
      line-height: 1.25;
      text-align: center;
      word-break: break-word;
      max-width: 90%;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    }
    .cover-direct {
      font-size: 10px;
      font-weight: 600;
      line-height: 1.25;
      text-align: center;
      word-break: break-word;
      max-width: 90%;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }
    .sample-text {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .card-footer {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      padding: 0 2px;
    }
    .preset-radio {
      cursor: pointer;
      accent-color: #2563eb;
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      margin: 0;
    }
    .preset-name {
      font-size: 0.75rem;
      font-weight: 500;
      color: #334155;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .action-bar {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .btn {
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: background-color 0.15s ease, opacity 0.15s ease;
    }
    .btn-primary {
      background-color: #0f172a;
      color: #ffffff;
      flex: 1;
    }
    .btn-primary:hover:not(:disabled) {
      background-color: #1e293b;
    }
    .btn-secondary {
      background-color: #ffffff;
      color: #334155;
      border: 1px solid #cbd5e1;
    }
    .btn-secondary:hover:not(:disabled) {
      background-color: #f8fafc;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .status-box {
      margin-top: 12px;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.75rem;
      line-height: 1.4;
      border: 1px solid #e2e8f0;
      background-color: #f8fafc;
      color: #475569;
      word-break: break-word;
    }
    .status-info {
      background-color: #f0f9ff;
      border-color: #bae6fd;
      color: #0369a1;
    }
    .status-success {
      background-color: #f0fdf4;
      border-color: #bbf7d0;
      color: #15803d;
    }
    .status-warning {
      background-color: #fffbeb;
      border-color: #fde68a;
      color: #b45309;
    }
    .status-error {
      background-color: #fef2f2;
      border-color: #fecaca;
      color: #b91c1c;
    }
  </style>
</head>
<body>
  <main id="cover-picker-app" class="app-shell" aria-busy="true">
    <header class="app-header">
      <h1 class="app-title">Video Title Card</h1>
      <p class="app-subtitle">Select a cover style to apply to your video</p>
      <p class="app-note">Sample previews; actual title comes from filename locally, media stays in editor.</p>
    </header>

    <fieldset class="preset-fieldset">
      <legend class="sr-only">Choose a title card preset</legend>
      <div class="preset-grid">
        ${cardsHtml}
      </div>
    </fieldset>

    <div class="action-bar">
      <button type="button" id="apply-btn" class="btn btn-primary" disabled>
        Apply Cover Preset
      </button>
      <button type="button" id="reconnect-btn" class="btn btn-secondary">
        Reconnect
      </button>
    </div>

    <div
      id="status-box"
      class="status-box status-info"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      Initializing MCP Apps connection...
    </div>
  </main>

  <script>
    (function() {
      'use strict';

      var container = document.getElementById('cover-picker-app');
      var applyBtn = document.getElementById('apply-btn');
      var reconnectBtn = document.getElementById('reconnect-btn');
      var statusBox = document.getElementById('status-box');
      var radioInputs = document.querySelectorAll('input[name="coverPreset"]');
      var presetCards = document.querySelectorAll('.preset-card');

      var isInitialized = false;
      var bridgeAvailable = true;
      var isBusy = false;
      var activeOperationId = null;
      var currentGeneration = null;
      var currentVersion = null;
      var nextRpcId = 1;
      var pendingRequests = new Map();
      var pollingTimer = null;
      var pollStartTime = 0;
      var MAX_POLL_MS = 60000;
      var POLL_INTERVAL_MS = 1000;
      var initPromise = null;

      function setStatus(text, type) {
        if (!statusBox) return;
        statusBox.textContent = text;
        statusBox.className = 'status-box status-' + (type || 'info');
      }

      function setBusy(busy) {
        isBusy = busy;
        if (container) {
          container.setAttribute('aria-busy', busy ? 'true' : 'false');
        }
        updateButtonStates();
      }

      function updateButtonStates() {
        var canInteract = isInitialized && bridgeAvailable && !isBusy;
        if (applyBtn) {
          applyBtn.disabled = !canInteract || !!activeOperationId;
        }
        if (reconnectBtn) {
          reconnectBtn.disabled = isBusy;
        }
        radioInputs.forEach(function(r) {
          r.disabled = !isInitialized || isBusy;
        });
      }

      function extractContentText(content) {
        if (!content) return '';
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
          for (var i = 0; i < content.length; i++) {
            var item = content[i];
            if (item && item.type === 'text' && typeof item.text === 'string') {
              return item.text;
            }
          }
        }
        return '';
      }

      function handleMetadataUpdate(data) {
        if (!data || typeof data !== 'object') return;
        var meta = data.metadata || data;
        if (typeof meta.generation === 'number') {
          currentGeneration = meta.generation;
        }
        if (typeof meta.version === 'number') {
          currentVersion = meta.version;
        }
      }

      function sendRpcRequest(method, params) {
        return new Promise(function(resolve, reject) {
          var id = 'rpc-' + (nextRpcId++);
          var timer = setTimeout(function() {
            pendingRequests.delete(id);
            reject(new Error('Request timed out after 8s: uncertainty error for ' + method));
          }, 8000);

          pendingRequests.set(id, {
            resolve: function(val) {
              clearTimeout(timer);
              resolve(val);
            },
            reject: function(err) {
              clearTimeout(timer);
              reject(err);
            },
            method: method
          });

          var payload = {
            jsonrpc: '2.0',
            id: id,
            method: method,
            params: params || {}
          };

          try {
            window.parent.postMessage(payload, '*');
          } catch (err) {
            clearTimeout(timer);
            pendingRequests.delete(id);
            reject(new Error('Failed to postMessage: ' + (err && err.message ? err.message : 'unknown error')));
          }
        });
      }

      function sendNotification(method, params) {
        try {
          window.parent.postMessage({
            jsonrpc: '2.0',
            method: method,
            params: params || {}
          }, '*');
        } catch (err) {
          // host notification best effort
        }
      }

      function callTool(name, args) {
        return sendRpcRequest('tools/call', {
          name: name,
          arguments: args || {}
        }).then(function(res) {
          if (!res) throw new Error('Tool returned no result');
          if (res.isError) {
            var errText = extractContentText(res.content) || 'Tool execution error';
            throw new Error(errText);
          }
          var text = extractContentText(res.content);
          if (!text) return res;
          try {
            return JSON.parse(text);
          } catch (e) {
            return text;
          }
        });
      }

      window.addEventListener('message', function(event) {
        // Only accept events from parent
        if (event.source !== window.parent) return;

        var data = event.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch (e) { return; }
        }
        if (!data || typeof data !== 'object') return;

        // Response correlation by id
        if (data.id !== undefined && data.id !== null) {
          var pending = pendingRequests.get(data.id);
          if (pending) {
            pendingRequests.delete(data.id);
            if (data.error) {
              var errMsg = data.error.message || ('JSON-RPC error ' + data.error.code);
              pending.reject(new Error(errMsg));
              return;
            }
            var result = data.result;
            if (result && result.isError) {
              var errText = extractContentText(result.content) || 'Tool execution error';
              pending.reject(new Error(errText));
              return;
            }
            pending.resolve(result);
            return;
          }
        }

        // Host notifications
        if (data.method === 'ui/notifications/tool-result') {
          var res = data.params && (data.params.result || data.params);
          if (res && res.content) {
            var text = extractContentText(res.content);
            if (text) {
              try {
                var parsed = JSON.parse(text);
                handleMetadataUpdate(parsed);
              } catch (e) {}
            }
          }
          return;
        }

        if (data.method === 'ui/notifications/tool-input') {
          // Safely ignored
          return;
        }

        if (data.method === 'ui/notifications/host-context-changed') {
          // Host context changed response if relevant
          return;
        }
      });

      function initializeBridge() {
        if (window.parent === window) {
          bridgeAvailable = false;
          isInitialized = false;
          initPromise = null;
          setStatus('Host bridge unavailable: not embedded in MCP Apps host.', 'error');
          updateButtonStates();
          return Promise.reject(new Error('Host bridge unavailable: not embedded in MCP Apps host.'));
        }

        if (isInitialized) {
          return Promise.resolve();
        }

        if (initPromise) {
          return initPromise;
        }

        setStatus('Initializing MCP Apps protocol...', 'info');

        initPromise = sendRpcRequest('ui/initialize', {
          protocolVersion: '2026-01-26',
          appInfo: {
            name: 'CoverPickerView',
            version: '0.1.0'
          },
          appCapabilities: {}
        }).then(function(result) {
          // Validate protocolVersion is expected
          var version = result && result.protocolVersion;
          if (version !== '2026-01-26') {
            bridgeAvailable = false;
            isInitialized = false;
            var verErr = 'Unsupported protocolVersion: ' + (version || 'missing') + ' (expected 2026-01-26).';
            setStatus('Host bridge unavailable: ' + verErr, 'error');
            updateButtonStates();
            throw new Error(verErr);
          }

          // Must advertise hostCapabilities.serverTools before enabling direct tools/call
          var hostCaps = result && (result.hostCapabilities || result.capabilities);
          var hasServerTools = Boolean(hostCaps && hostCaps.serverTools);
          if (!hasServerTools) {
            bridgeAvailable = false;
            isInitialized = false;
            var capErr = 'Host does not advertise hostCapabilities.serverTools. Tool execution disabled.';
            setStatus('Host bridge unavailable: ' + capErr, 'error');
            updateButtonStates();
            throw new Error(capErr);
          }

          sendNotification('ui/notifications/initialized', {});
          isInitialized = true;
          bridgeAvailable = true;

          updateButtonStates();

          return callTool('getproject', {}).then(function(project) {
            handleMetadataUpdate(project);
            setStatus('Ready. Choose a preset and click Apply.', 'info');
          }).catch(function(err) {
            var msg = err && err.message ? err.message : String(err);
            if (msg.includes('PROJECT_EXPIRED_OR_REVOKED') || msg.includes('EXPIRED') || msg.includes('REVOKED')) {
              bridgeAvailable = false;
              setStatus('Project expired or revoked. Please reconnect in Video Scissors.', 'error');
            } else {
              setStatus('Connected. Project metadata read: ' + msg, 'warning');
            }
            updateButtonStates();
          });
        }).catch(function(err) {
          bridgeAvailable = false;
          isInitialized = false;
          var msg = err && err.message ? err.message : String(err);
          setStatus('Host bridge unavailable: ' + msg, 'error');
          updateButtonStates();
          throw err;
        }).finally(function() {
          initPromise = null;
        });

        return initPromise;
      }

      function pollStatus(opId) {
        if (pollingTimer) {
          clearTimeout(pollingTimer);
          pollingTimer = null;
        }
        pollStartTime = Date.now();
        setBusy(true);

        function tick() {
          var elapsed = Date.now() - pollStartTime;
          if (elapsed >= MAX_POLL_MS) {
            setBusy(false);
            setStatus('Operation is still pending (timed out after 60s). Click Reconnect to check status.', 'warning');
            updateButtonStates();
            return;
          }

          callTool('status', { operationId: opId }).then(function(res) {
            var state = res && res.state;
            if (res && res.metadata) {
              handleMetadataUpdate(res.metadata);
            }

            if (state === 'queued' || state === 'claimed') {
              var remainingSec = Math.max(0, Math.round((MAX_POLL_MS - elapsed) / 1000));
              setStatus('Operation pending (' + state + ')... ' + remainingSec + 's remaining', 'info');
              pollingTimer = setTimeout(tick, POLL_INTERVAL_MS);
            } else if (state === 'completed') {
              activeOperationId = null;
              setBusy(false);
              setStatus('Cover preset applied successfully! Download your MP4 in local Video Scissors editor.', 'success');
              updateButtonStates();
            } else if (state === 'failed') {
              activeOperationId = null;
              setBusy(false);
              setStatus('Cover preset application failed (terminal).', 'error');
              updateButtonStates();
            } else if (state === 'cancelled') {
              activeOperationId = null;
              setBusy(false);
              setStatus('Operation was cancelled (terminal).', 'warning');
              updateButtonStates();
            } else if (state === 'stale') {
              activeOperationId = null;
              setBusy(false);
              setStatus('Operation was rejected as stale (terminal).', 'error');
              updateButtonStates();
            } else {
              // Unknown/null status is uncertain, preserve ID.
              setBusy(false);
              setStatus('Status unconfirmed (' + (state || 'missing') + '). Operation remains locked. Click Reconnect to retry.', 'warning');
              updateButtonStates();
            }
          }).catch(function(err) {
            var msg = err && err.message ? err.message : String(err);
            if (msg.includes('PROJECT_EXPIRED_OR_REVOKED') || msg.includes('EXPIRED') || msg.includes('REVOKED')) {
              activeOperationId = null;
              bridgeAvailable = false;
              setBusy(false);
              setStatus('Project expired or revoked. Please reconnect in Video Scissors.', 'error');
            } else {
              setBusy(false);
              setStatus('Status check failed (' + msg + '). Operation remains locked. Click Reconnect to retry.', 'warning');
            }
            updateButtonStates();
          });
        }

        tick();
      }

      if (applyBtn) {
        applyBtn.addEventListener('click', function() {
          if (isBusy || !isInitialized || !bridgeAvailable) return;

          // Track active operation ID for reconnect and check its status before allowing another apply
          if (activeOperationId) {
            setStatus('Operation ' + activeOperationId + ' is already active. Checking status...', 'info');
            pollStatus(activeOperationId);
            return;
          }

          setBusy(true);
          setStatus('Obtaining current project metadata...', 'info');

          callTool('getproject', {}).then(function(proj) {
            var meta = (proj && proj.metadata) || proj;
            if (!meta || typeof meta.generation !== 'number' || typeof meta.version !== 'number') {
              throw new Error('Project metadata missing generation/version');
            }
            handleMetadataUpdate(meta);

            var selected = document.querySelector('input[name="coverPreset"]:checked');
            var presetId = selected ? selected.value : (radioInputs[0] ? radioInputs[0].value : 'midnight-black');

            var opId = crypto.randomUUID();
            activeOperationId = opId;
            updateButtonStates();

            setStatus('Submitting cover preset...', 'info');

            return callTool('applycoverpreset', {
              operationId: opId,
              generation: meta.generation,
              version: meta.version,
              presetId: presetId
            }).then(function(applyResult) {
              if (applyResult && applyResult.error) {
                if (applyResult.error === 'STALE_OR_REJECTED') {
                  activeOperationId = null;
                  setBusy(false);
                  setStatus('Application rejected: project state is stale (STALE_OR_REJECTED).', 'error');
                  updateButtonStates();
                  return;
                }
                throw new Error(applyResult.error);
              }
              pollStatus(opId);
            }).catch(function(err) {
              setBusy(false);
              var msg = err && err.message ? err.message : String(err);
              if (msg.includes('STALE_OR_REJECTED')) {
                activeOperationId = null;
                setStatus('Application rejected: project metadata is stale.', 'error');
              } else if (msg.includes('PROJECT_EXPIRED_OR_REVOKED') || msg.includes('EXPIRED') || msg.includes('REVOKED')) {
                activeOperationId = null;
                bridgeAvailable = false;
                setStatus('Project expired or revoked. Please reconnect in Video Scissors.', 'error');
              } else {
                // Once applycoverpreset is sent, transport error/timeout/uncertain COMMAND_REJECTED MUST retain activeOperationId
                setStatus('Cover preset submission unconfirmed (' + msg + '). Active operation retained. Click Reconnect to check status.', 'warning');
              }
              updateButtonStates();
            });
          }).catch(function(err) {
            setBusy(false);
            var msg = err && err.message ? err.message : String(err);
            if (msg.includes('PROJECT_EXPIRED_OR_REVOKED') || msg.includes('EXPIRED') || msg.includes('REVOKED')) {
              bridgeAvailable = false;
              setStatus('Project expired or revoked. Please reconnect in Video Scissors.', 'error');
            } else {
              setStatus('Failed to read project metadata: ' + msg, 'error');
            }
            updateButtonStates();
          });
        });
      }

      if (reconnectBtn) {
        reconnectBtn.addEventListener('click', function() {
          if (isBusy) return;
          setBusy(true);
          setStatus('Reconnecting...', 'info');

          initializeBridge().then(function() {
            // Reconnect must check active ID first and never repeat mutation; if status missing, say unconfirmed and keep locked.
            if (activeOperationId) {
              setStatus('Checking status of active operation (' + activeOperationId + ')...', 'info');
              pollStatus(activeOperationId);
              return;
            }

            return callTool('getproject', {}).then(function(proj) {
              bridgeAvailable = true;
              handleMetadataUpdate(proj);
              setBusy(false);
              setStatus('Connected to project. Ready to apply cover.', 'success');
              updateButtonStates();
            });
          }).catch(function(err) {
            setBusy(false);
            var msg = err && err.message ? err.message : String(err);
            if (msg.includes('PROJECT_EXPIRED_OR_REVOKED') || msg.includes('EXPIRED') || msg.includes('REVOKED')) {
              bridgeAvailable = false;
              setStatus('Project expired or revoked. Please reconnect in Video Scissors.', 'error');
            } else {
              setStatus('Reconnect failed: ' + msg, 'error');
            }
            updateButtonStates();
          });
        });
      }

      // Selection itself must never call a tool
      radioInputs.forEach(function(radio) {
        radio.addEventListener('change', function() {
          presetCards.forEach(function(card) {
            var r = card.querySelector('input[type="radio"]');
            if (r && r.checked) {
              card.classList.add('selected');
            } else {
              card.classList.remove('selected');
            }
          });
        });
      });

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          initializeBridge().catch(function() {});
        });
      } else {
        initializeBridge().catch(function() {});
      }
    })();
  </script>
</body>
</html>`;
}
