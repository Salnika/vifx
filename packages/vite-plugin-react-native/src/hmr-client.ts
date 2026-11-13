/**
 * Vifx HMR client source, injected in place of
 * `react-native/Libraries/Utilities/HMRClient` in native bundles.
 *
 * It is the app's end of the dev server's `/hot` channel, for both Fast
 * Refresh flavors:
 *
 * - **Dev engine** (default dev bundle): a `vifx:patch` message is handed to
 *   the in-app runtime (dev-runtime.ts), and the server is told what became of
 *   it. The client introduces itself with the bundle it runs (`vifx:hello`),
 *   reconnects on its own, and reloads when the server says it is stale.
 * - **Registry format** (`moduleFormat: "metro"`): each Metro-shaped `update`
 *   message carries the changed modules' `__d(...)` code, evaluated in global
 *   scope so the module-registry runtime's `define` routes it to
 *   `global.__accept` (the Fast Refresh engine in `module-registry/runtime.ts`).
 *
 * For both it forwards `console.*` output to the server (what Metro prints as
 * `LOG` lines) and shows a compile error the way React Native shows Metro's.
 *
 * Two deliberate choices keep this safe and faithful:
 *
 * - **Inert without a socket URL.** The client only connects when
 *   `globalThis.__VIFX_HMR_URL` is present (injected by the dev server).
 *   Production bundles get a no-op `HMRClient`.
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

/**
 * Global the dev engine's server writes `{ session, seq }` to: which server
 * process built this bundle, and how many saves it includes. The app sends it
 * back when it (re)connects, so a bundle that missed a save — or was served by
 * a server that has since restarted — is reloaded instead of patched.
 */
export const VIFX_HMR_STATE_GLOBAL = "__VIFX_HMR_STATE";

export const VIFX_HMR_CLIENT_SOURCE = `var VIFX_HMR_URL_GLOBAL = ${JSON.stringify(VIFX_HMR_URL_GLOBAL)};
var VIFX_HMR_STATE_GLOBAL = ${JSON.stringify(VIFX_HMR_STATE_GLOBAL)};
var vifxSocket = null;
var vifxEnabled = false;
var vifxLastError = null;
var vifxCompileErrorShown = false;
var vifxReconnectTimer = null;
var vifxReconnectDelayMs = 250;
// Number of saves this app holds: those in its bundle, then one per patch.
var vifxSeq = null;

function vifxHmrState() {
  var state = typeof globalThis !== "undefined" ? globalThis[VIFX_HMR_STATE_GLOBAL] : undefined;
  return state && typeof state === "object" ? state : null;
}

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

// Rolldown dev engine (default dev bundle): the in-app runtime installed by
// the bundle prelude applies the patch; this client only carries messages.
function vifxDevRuntime() {
  return typeof globalThis !== "undefined" ? globalThis.__vifxDevRuntime : undefined;
}

function vifxSend(message) {
  if (vifxSocket != null && vifxSocket.readyState === 1) {
    vifxSocket.send(JSON.stringify(message));
    return true;
  }
  return false;
}

// console.* forwarding to the dev server's terminal (Metro's "log" message).
// Formatting is deliberately small and total: it must never throw, recurse
// without bound, or log (that would loop back into this function).
var vifxPendingLogs = [];

function vifxFormatLogValue(value, depth, seen) {
  var type = typeof value;
  if (type === "string") {
    return depth === 0 ? value : JSON.stringify(value);
  }
  if (value == null || type === "number" || type === "boolean") {
    return String(value);
  }
  if (type === "function") {
    return "[Function " + (value.name || "anonymous") + "]";
  }
  if (type === "symbol" || type === "bigint") {
    return value.toString();
  }
  if (value instanceof Error) {
    return value.stack || value.name + ": " + value.message;
  }
  if (seen.indexOf(value) !== -1) {
    return "[Circular]";
  }
  if (depth >= 3) {
    return Array.isArray(value) ? "[Array]" : "[Object]";
  }
  seen.push(value);
  var parts = [];
  var index;
  if (Array.isArray(value)) {
    for (index = 0; index < value.length && index < 50; index++) {
      parts.push(vifxFormatLogValue(value[index], depth + 1, seen));
    }
    if (value.length > 50) {
      parts.push("... " + (value.length - 50) + " more");
    }
    seen.pop();
    return "[" + parts.join(", ") + "]";
  }
  var keys = Object.keys(value);
  for (index = 0; index < keys.length && index < 50; index++) {
    parts.push(keys[index] + ": " + vifxFormatLogValue(value[keys[index]], depth + 1, seen));
  }
  if (keys.length > 50) {
    parts.push("... " + (keys.length - 50) + " more");
  }
  seen.pop();
  return "{" + parts.join(", ") + "}";
}

function vifxForwardLog(level, data) {
  var formatted = [];
  try {
    for (var index = 0; index < data.length; index++) {
      formatted.push(vifxFormatLogValue(data[index], 0, []));
    }
  } catch (error) {
    return;
  }
  var message = { type: "log", level: level, data: formatted };
  try {
    if (!vifxSend(message)) {
      // Keep a reasonable number of early logs for when the socket opens.
      vifxPendingLogs.push(message);
      if (vifxPendingLogs.length > 100) {
        vifxPendingLogs.shift();
      }
    }
  } catch (error) {}
}

function vifxFlushLogs() {
  var pending = vifxPendingLogs;
  vifxPendingLogs = [];
  for (var index = 0; index < pending.length; index++) {
    try {
      vifxSend(pending[index]);
    } catch (error) {}
  }
}

// React Native's LogBox, when the bundle has it (vifxLoadLogBox is defined by
// the bundler in front of this source; see renderHmrClientHostHooks).
function vifxLogBox() {
  if (typeof vifxLoadLogBox !== "function") {
    return null;
  }
  try {
    var loaded = vifxLoadLogBox();
    return loaded && loaded.default ? loaded.default : loaded;
  } catch (error) {
    return null;
  }
}

// A compile error, shown the way React Native shows Metro's: an uncaught
// error whose message LogBox parses into the syntax-error screen (file,
// position and code frame). Its stack is this function, so symbolicating it
// would be wasted work.
function vifxShowCompileError(body) {
  var description = body && body.message ? body.message : "bundling error";
  var error = new Error((body && body.type ? body.type + " " : "") + description);
  error.preventSymbolication = true;
  vifxLastError = error;
  vifxCompileErrorShown = true;
  if (typeof setTimeout === "function") {
    setTimeout(function () {
      throw error;
    }, 0);
  } else if (typeof console !== "undefined" && console.error) {
    console.error("[Vifx HMR] " + description);
  }
}

// The edit that fixes a compile error has been applied: take the error screen
// down, as React Native does on every Metro update.
function vifxClearCompileError() {
  if (!vifxCompileErrorShown) {
    return;
  }
  vifxCompileErrorShown = false;
  var logBox = vifxLogBox();
  if (logBox && typeof logBox.clearAllLogs === "function") {
    try {
      logBox.clearAllLogs();
    } catch (error) {}
  }
}

function vifxApplyPatch(patch) {
  var runtime = vifxDevRuntime();
  if (!runtime) {
    return;
  }
  try {
    runtime.applyPatch(patch);
  } catch (error) {
    vifxLastError = error;
    var description = error && error.message ? error.message : String(error);
    vifxSend({ type: "vifx:failed", filename: patch.filename, message: description });
    if (typeof console !== "undefined" && console.error) {
      console.error("[Vifx HMR] " + description);
    }
    return;
  }
  vifxLastError = null;
  vifxClearCompileError();
  if (typeof patch.seq === "number") {
    vifxSeq = patch.seq;
  }
  // Tells the server which modules this app now holds, so the next patch
  // carries only what is new to it, and how far the edit propagated.
  vifxSend({
    type: "vifx:delivered",
    filename: patch.filename,
    rerun: (runtime.lastRerunIds || []).length,
  });
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
    vifxClearCompileError();
  } else if (message.type === "vifx:patch") {
    vifxApplyPatch(message.body || {});
  } else if (message.type === "vifx:reload") {
    // The server cannot patch this app (it missed a save, or the server
    // restarted since its bundle was built): only a fresh bundle is right.
    var devRuntime = vifxDevRuntime();
    if (devRuntime && typeof devRuntime.fullRefresh === "function") {
      devRuntime.fullRefresh((message.body && message.body.reason) || "The dev server asked for a reload");
    }
  } else if (message.type === "error") {
    vifxShowCompileError(message.body || {});
  }
  // update-start / update-done are advisory; the runtime debounces the refresh.
}

// The socket drops when the dev server restarts or the device sleeps. Without
// a reconnect the app would silently stop receiving updates; with it, the
// server decides on "vifx:hello" whether this app can still be patched.
function vifxScheduleReconnect() {
  // Dev engine only: its server can tell whether a returning app is current.
  if (!vifxHmrState()) {
    return;
  }
  if (!vifxEnabled || vifxReconnectTimer != null || typeof setTimeout !== "function") {
    return;
  }
  var delay = vifxReconnectDelayMs;
  vifxReconnectDelayMs = Math.min(vifxReconnectDelayMs * 2, 5000);
  vifxReconnectTimer = setTimeout(function () {
    vifxReconnectTimer = null;
    vifxConnect();
  }, delay);
}

function vifxConnect() {
  var url = vifxHmrSocketUrl();
  if (!url || typeof WebSocket === "undefined" || vifxSocket != null) {
    return;
  }
  var socket;
  try {
    socket = new WebSocket(url);
  } catch (error) {
    vifxLastError = error;
    vifxScheduleReconnect();
    return;
  }
  vifxSocket = socket;
  socket.onopen = function () {
    vifxReconnectDelayMs = 250;
    var runtime = vifxDevRuntime();
    if (runtime) {
      var state = vifxHmrState();
      if (vifxSeq === null && state && typeof state.seq === "number") {
        vifxSeq = state.seq;
      }
      vifxSend({
        type: "vifx:hello",
        clientId: runtime.clientId,
        session: state ? state.session : undefined,
        seq: vifxSeq,
      });
      // The runtime decides when an edit cannot be applied in place; the
      // server prints why.
      runtime.onFullRefresh = function (reason) {
        vifxSend({ type: "vifx:reload", reason: String(reason) });
      };
    }
    vifxFlushLogs();
  };
  socket.onmessage = function (event) {
    vifxHandleMessage(event && event.data);
  };
  socket.onerror = function (event) {
    vifxLastError = event;
  };
  socket.onclose = function () {
    // A socket replaced by disable()/enable() must not clear its successor.
    if (vifxSocket === socket) {
      vifxSocket = null;
      vifxScheduleReconnect();
    }
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
    if (vifxReconnectTimer != null) {
      clearTimeout(vifxReconnectTimer);
      vifxReconnectTimer = null;
    }
    if (vifxSocket != null) {
      var socket = vifxSocket;
      vifxSocket = null;
      try {
        socket.close();
      } catch (error) {}
    }
  },
  registerBundle: function () {},
  log: function (level, data) {
    if (vifxHmrSocketUrl()) {
      vifxForwardLog(level, data || []);
    }
  },
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
