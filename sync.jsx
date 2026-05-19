// sync.jsx — auto-sync via URL workspace ID. No setup UI.
// Workspace lives at /#ws=ID in the URL. First load creates one and writes the URL.
// Anyone with the URL sees the same data.

const SYNC_KEY = "sbm_workspace_v4";
// JSONBin.io: reliable JSON storage. Requires a free API key in config.js.
const API_BASE = "https://api.jsonbin.io/v3/b";
const getApiKey = () => (window.SBM_CONFIG && window.SBM_CONFIG.JSONBIN_API_KEY) || "";
const hasApiKey = () => {
  const k = getApiKey();
  return k && k !== "PASTE_KEY_HERE";
};

const readWsFromUrl = () => {
  const h = window.location.hash || "";
  const m = h.match(/ws=([^&\s]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

const writeWsToUrl = (id) => {
  const newHash = `#ws=${id}`;
  if (window.location.hash !== newHash) {
    // Use replaceState to avoid adding history entries
    history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
  }
};

const loadStoredWs = () => {
  try { return localStorage.getItem(SYNC_KEY); } catch (e) { return null; }
};
const saveStoredWs = (id) => {
  try { localStorage.setItem(SYNC_KEY, id); } catch (e) {}
};

async function createRemote(initialPayload) {
  if (!hasApiKey()) throw new Error("MISSING_KEY");
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": getApiKey(),
      "X-Bin-Private": "false",
    },
    body: JSON.stringify(initialPayload),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error("INVALID_KEY");
    throw new Error("Create failed: " + res.status);
  }
  const data = await res.json();
  const id = data && data.metadata && data.metadata.id;
  if (!id) throw new Error("Server did not return a bin ID");
  return id;
}

async function fetchRemote(id) {
  const headers = hasApiKey() ? { "X-Master-Key": getApiKey() } : {};
  const res = await fetch(`${API_BASE}/${id}/latest`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Fetch failed: " + res.status);
  const data = await res.json();
  return data && data.record;
}

async function pushRemote(id, payload) {
  if (!hasApiKey()) throw new Error("MISSING_KEY");
  const res = await fetch(`${API_BASE}/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": getApiKey(),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error("INVALID_KEY");
    throw new Error("Push failed: " + res.status);
  }
}

function useSync(localClients, setClients) {
  const [workspaceId, setWorkspaceId] = React.useState(() => readWsFromUrl() || loadStoredWs());
  const [status, setStatus] = React.useState({ state: "syncing", label: "Connecting…" });
  const [showShare, setShowShare] = React.useState(false);
  const [bootstrapError, setBootstrapError] = React.useState(null);

  const payloadRef = React.useRef({ clients: localClients, updatedAt: Date.now() });
  const lastPulledRef = React.useRef(0);
  const isApplyingRemoteRef = React.useRef(false);
  const initialReadyRef = React.useRef(false);
  const [bootstrapAttempt, setBootstrapAttempt] = React.useState(0);

  // keep payload in sync with local
  React.useEffect(() => {
    if (!isApplyingRemoteRef.current) {
      payloadRef.current = { clients: localClients, updatedAt: Date.now() };
    }
  }, [localClients]);

  // bootstrap: ensure we have a workspace
  React.useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      setBootstrapError(null);
      const urlWs = readWsFromUrl();
      const storedWs = loadStoredWs();
      const targetId = urlWs || storedWs;

      // CASE 1: a workspace exists somewhere → use it
      if (targetId) {
        // make sure URL reflects it
        writeWsToUrl(targetId);
        saveStoredWs(targetId);
        if (workspaceId !== targetId) setWorkspaceId(targetId);

        try {
          setStatus({ state: "syncing", label: "Loading…" });
          let remote = await fetchRemote(targetId);
          if (cancelled) return;
          if (!remote) {
            // workspace ID points to nothing — recreate it with local data
            // (jsonblob may have expired the blob; orphans get GC'd after months of inactivity)
            const fresh = { clients: localClients, updatedAt: Date.now() };
            // can't restore the same ID — must create a new one
            const newId = await createRemote(fresh);
            writeWsToUrl(newId);
            saveStoredWs(newId);
            setWorkspaceId(newId);
            payloadRef.current = fresh;
            lastPulledRef.current = fresh.updatedAt;
          } else {
            isApplyingRemoteRef.current = true;
            setClients(remote.clients || []);
            payloadRef.current = remote;
            lastPulledRef.current = remote.updatedAt || Date.now();
          }
          initialReadyRef.current = true;
          setStatus({ state: "ok", label: "Synced" });
        } catch (e) {
          if (!cancelled) { setStatus({ state: "error", label: "Offline" }); setBootstrapError(e.message || "Could not connect"); }
        }
        return;
      }

      // CASE 2: no workspace anywhere → create one (carry over any local data)
      try {
        setStatus({ state: "syncing", label: "Setting up…" });
        const initial = { clients: localClients, updatedAt: Date.now() };
        const newId = await createRemote(initial);
        if (cancelled) return;
        writeWsToUrl(newId);
        saveStoredWs(newId);
        setWorkspaceId(newId);
        payloadRef.current = initial;
        lastPulledRef.current = initial.updatedAt;
        initialReadyRef.current = true;
        setShowShare(true); // first-time setup: show the share banner
        setStatus({ state: "ok", label: "Synced" });
      } catch (e) {
        if (!cancelled) { setStatus({ state: "error", label: "Offline" }); setBootstrapError(e.message || "Could not connect"); }
      }
    };

    bootstrap();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [bootstrapAttempt]);

  // push when local changes — debounced
  React.useEffect(() => {
    if (!workspaceId || !initialReadyRef.current) return;
    if (isApplyingRemoteRef.current) {
      isApplyingRemoteRef.current = false;
      return;
    }
    const t = setTimeout(async () => {
      try {
        setStatus({ state: "syncing", label: "Saving…" });
        await pushRemote(workspaceId, payloadRef.current);
        setStatus({ state: "ok", label: "Synced" });
      } catch (e) {
        setStatus({ state: "error", label: "Offline" });
      }
    }, 500);
    return () => clearTimeout(t);
  }, [localClients, workspaceId]);

  // periodic pull
  React.useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    let timer = null;
    const tick = async () => {
      try {
        const remote = await fetchRemote(workspaceId);
        if (cancelled) return;
        if (remote && Array.isArray(remote.clients)) {
          const remoteTime = remote.updatedAt || 0;
          const localTime = payloadRef.current.updatedAt || 0;
          if (remoteTime > lastPulledRef.current && remoteTime > localTime) {
            isApplyingRemoteRef.current = true;
            setClients(remote.clients);
            payloadRef.current = remote;
            lastPulledRef.current = remoteTime;
          }
        }
        if (initialReadyRef.current) setStatus({ state: "ok", label: "Synced" });
      } catch (e) {
        if (!cancelled) setStatus({ state: "error", label: "Offline" });
      }
      if (!cancelled) timer = setTimeout(tick, 7000);
    };
    timer = setTimeout(tick, 7000);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [workspaceId]);

  // Share URL (the current URL — which always contains #ws=)
  const isFileProto = typeof window !== "undefined" && window.location.protocol === "file:";
  const needsApiKey = !hasApiKey();
  const shareUrl = workspaceId && !isFileProto
    ? `${window.location.origin}${window.location.pathname}${window.location.search}#ws=${workspaceId}`
    : "";

  return {
    workspaceId,
    status,
    shareUrl,
    showShare,
    bootstrapError,
    isFileProto,
    needsApiKey,
    retryBootstrap: () => setBootstrapAttempt(a => a + 1),
    dismissShare: () => setShowShare(false),
    openShare: () => setShowShare(true),
  };
}

// ---------- Share dialog ----------
function ShareDialog({ sync }) {
  const { shareUrl, dismissShare, bootstrapError, isFileProto, needsApiKey, retryBootstrap, status } = sync;
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const hasUrl = !!shareUrl;
  const isConnecting = status.state === "syncing";
  const isKeyError = bootstrapError === "MISSING_KEY" || bootstrapError === "INVALID_KEY" || needsApiKey;

  return (
    <div className="modal-backdrop" onClick={dismissShare}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={dismissShare} aria-label="Close">×</button>
        <h2 className="modal-title">Share</h2>

        {isFileProto && (
          <div>
            <p className="modal-sub">
              You're viewing this file directly from your computer. To get a shareable link, deploy the site to Vercel first.
            </p>
          </div>
        )}

        {!isFileProto && isKeyError && !hasUrl && (
          <div>
            <p className="modal-sub">
              One-time setup: paste a free JSONBin API key into <code className="inline-code">config.js</code> to enable sync.
            </p>
            <ol className="setup-steps">
              <li>Go to <a href="https://jsonbin.io" target="_blank" rel="noopener">jsonbin.io</a> and sign up (Google sign-in is fastest)</li>
              <li>Click your profile (top right) → <strong>API Keys</strong></li>
              <li>Copy the <strong>X-Master-Key</strong> value</li>
              <li>In your GitHub repo, open <strong>config.js</strong> and paste the key, replacing <code className="inline-code">PASTE_KEY_HERE</code></li>
              <li>Commit &amp; push — Vercel will auto-redeploy in ~30s</li>
              <li>Refresh this page → share link will appear here</li>
            </ol>
            <p className="modal-foot">Free tier includes 10,000 requests/month — way more than you'll need.</p>
          </div>
        )}

        {!isFileProto && !isKeyError && hasUrl && (
          <div>
            <p className="modal-sub">
              Send this link to your partner. Anyone with this URL sees the same client list, calendar, and notes — synced live across all devices.
            </p>
            <div className="code-box">
              <code>{shareUrl}</code>
              <button className="btn small primary" onClick={copy}>
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <p className="modal-foot">
              Bookmark this URL on every device you use. Anyone with the link can read &amp; edit — treat it like a password.
            </p>
          </div>
        )}

        {!isFileProto && !isKeyError && !hasUrl && (
          <div>
            <p className="modal-sub">
              {isConnecting
                ? "Setting up your workspace — this usually takes a second…"
                : "Couldn't reach the sync server. Check your internet connection and try again."}
            </p>
            {bootstrapError && !isConnecting && (
              <p className="modal-err">{bootstrapError}</p>
            )}
            <div className="modal-actions">
              {!isConnecting && (
                <button className="btn primary" onClick={retryBootstrap}>Try again</button>
              )}
              <button className="btn" onClick={dismissShare}>Close</button>
            </div>
          </div>
        )}

        {!isFileProto && !isKeyError && hasUrl && (
          <div className="modal-actions" style={{ marginTop: 14 }}>
            <button className="btn" onClick={dismissShare}>Got it</button>
          </div>
        )}
      </div>
    </div>
  );
}

window.useSync = useSync;
window.ShareDialog = ShareDialog;
