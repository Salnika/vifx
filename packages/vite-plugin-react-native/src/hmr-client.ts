/**
 * Vifx HMR client source, injected in place of
 * `react-native/Libraries/Utilities/HMRClient` in development `moduleFormat:
 * "metro"` bundles (FR-B of Fast Refresh).
 *
 * It connects to the Vifx dev server's `/hot` channel and applies Metro-shaped
 * HMR deltas: each `update` message carries the changed modules' `__d(...)`
 * code, which is evaluated in global scope so the module-registry runtime's
 * `define` routes it to `global.__accept` (the Fast Refresh engine ported in
 * `module-registry/runtime.ts`). React state is preserved because only the
 * changed module is re-run and React Refresh reconciles the component tree.
 *
 * Two deliberate choices keep this safe and faithful:
 *
 * - **Inert without a socket URL.** The client only connects when
 *   `globalThis.__VIFX_HMR_URL` is present (injected by the dev server for metro
 *   dev bundles only). Production and hoisted bundles get a no-op `HMRClient`,
 *   exactly like the previous stub.
 * - **Hermes-safe evaluation.** Plain `eval` is disabled under Hermes, so module
 *   code is injected through `globalThis.globalEvalWithSourceUrl(code, url)` (the
 *   dev-mode entry point Hermes/Metro use), falling back to indirect `eval` only
 *   off-Hermes.
 *
 * `setUpReactRefresh` (run from RN's InitializeCore) installs
 * `global.__ReactRefresh`, which the runtime reads — this client does not manage
 * React Refresh itself; it only delivers module updates over the socket.
 */

/** Global the dev server writes the `/hot` WebSocket URL to (see FR-D wiring). */
export const VIFX_HMR_URL_GLOBAL = "__VIFX_HMR_URL";

export const VIFX_HMR_CLIENT_SOURCE = `var VIFX_HMR_URL_GLOBAL = ${JSON.stringify(VIFX_HMR_URL_GLOBAL)};
var vifxSocket = null;
var vifxEnabled = false;
var vifxLastError = null;

function vifxHmrSocketUrl() {
  return typeof globalThis !== "undefined" ? globalThis[VIFX_HMR_URL_GLOBAL] : undefined;
}

function vifxInjectModule(code, sourceURL) {
  // Hermes disables plain eval; globalEvalWithSourceUrl is the dev-mode entry
  // point and attaches a real source URL for stack traces / symbolication.
  if (typeof globalThis !== "undefined" && typeof globalThis.globalEvalWithSourceUrl === "function") {
    globalThis.globalEvalWithSourceUrl(code, sourceURL || null);
    return;
  }
  (0, eval)(code);
}

function vifxApplyUpdate(body) {
  var added = (body && body.added) || [];
  for (var i = 0; i < added.length; i++) {
    vifxInjectModule(added[i].module[1], added[i].sourceURL);
  }
  var modified = (body && body.modified) || [];
  for (var j = 0; j < modified.length; j++) {
    vifxInjectModule(modified[j].module[1], modified[j].sourceURL);
  }
  var deleted = (body && body.deleted) || [];
  if (
    deleted.length > 0 &&
    typeof globalThis !== "undefined" &&
    typeof globalThis.__vifxFullReload === "function"
  ) {
    globalThis.__vifxFullReload("Module deleted");
  }
}

function vifxHandleMessage(raw) {
  var message;
  try {
    message = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    return;
  }
  if (!message || typeof message.type !== "string") {
    return;
  }
  if (message.type === "update") {
    vifxApplyUpdate(message.body || {});
  } else if (message.type === "error") {
    var description =
      message.body && message.body.message ? message.body.message : "bundling error";
    if (typeof console !== "undefined" && console.error) {
      console.error("[Vifx HMR] " + description);
    }
  }
  // update-start / update-done are advisory; the runtime debounces the refresh.
}

function vifxConnect() {
  var url = vifxHmrSocketUrl();
  if (!url || typeof WebSocket === "undefined" || vifxSocket != null) {
    return;
  }
  try {
    vifxSocket = new WebSocket(url);
  } catch (error) {
    vifxLastError = error;
    vifxSocket = null;
    return;
  }
  vifxSocket.onmessage = function (event) {
    vifxHandleMessage(event && event.data);
  };
  vifxSocket.onerror = function (event) {
    vifxLastError = event;
  };
  vifxSocket.onclose = function () {
    vifxSocket = null;
  };
}

var HMRClient = {
  setup: function () {
    vifxEnabled = true;
    vifxConnect();
  },
  enable: function () {
    vifxEnabled = true;
    vifxConnect();
  },
  disable: function () {
    vifxEnabled = false;
    if (vifxSocket != null) {
      try {
        vifxSocket.close();
      } catch (error) {}
      vifxSocket = null;
    }
  },
  registerBundle: function () {},
  log: function () {},
  hasError: function () {
    return vifxLastError != null;
  },
  isEnabled: function () {
    return vifxEnabled;
  },
};

// Connect as soon as a socket URL is available, even if the host never calls
// setup()/enable(). Deferred a tick so WebSocket and the URL global are ready.
// Idempotent with setup()/enable() via the vifxSocket != null guard.
if (vifxHmrSocketUrl()) {
  vifxEnabled = true;
  if (typeof setTimeout === "function") {
    setTimeout(vifxConnect, 0);
  } else {
    vifxConnect();
  }
}

export default HMRClient;
`;
