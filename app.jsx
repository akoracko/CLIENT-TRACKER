const { useState, useEffect, useMemo } = React;

// ---------- storage ----------
const STORAGE_KEY = "sbm_clients_v1";
const loadClients = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) { return []; }
};
const saveClients = (c) => localStorage.setItem(STORAGE_KEY, JSON.stringify(c));

// ---------- date helpers ----------
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const fmtDateShort = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const fmtMonth = (d) => d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
const todayISO = () => {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
};
const addDays = (iso, days) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
};
const daysBetween = (a, b) => {
  const d1 = new Date(a); d1.setHours(0,0,0,0);
  const d2 = new Date(b); d2.setHours(0,0,0,0);
  return Math.round((d2 - d1) / 86400000);
};
const sameDay = (a, b) => {
  const d1 = new Date(a); const d2 = new Date(b);
  return d1.getFullYear()===d2.getFullYear() && d1.getMonth()===d2.getMonth() && d1.getDate()===d2.getDate();
};

// ---------- ID helper ----------
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- App ----------
function App() {
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "accent": "#1FD75F",
    "darkMode": true
  }/*EDITMODE-END*/;
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [clients, setClients] = useState(loadClients);
  const [activeId, setActiveId] = useState(null);
  const [view, setView] = useState("clients"); // clients | calendar
  const [newName, setNewName] = useState("");

  const sync = useSync(clients, setClients);

  useEffect(() => { saveClients(clients); }, [clients]);
  useEffect(() => {
    if (clients.length && !activeId) setActiveId(clients[0].id);
    if (activeId && !clients.find(c => c.id === activeId)) {
      setActiveId(clients[0]?.id || null);
    }
  }, [clients, activeId]);

  // theme
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", tweaks.accent);
    document.documentElement.dataset.theme = tweaks.darkMode ? "dark" : "light";
  }, [tweaks.accent, tweaks.darkMode]);

  const active = clients.find(c => c.id === activeId);

  // ---------- client mutations ----------
  const addClient = () => {
    const name = newName.trim();
    if (!name) return;
    const today = todayISO();
    const c = {
      id: uid(),
      name,
      addedOn: today,
      nextCheckup: addDays(today, 14),
      notes: "",
      history: [],
    };
    setClients([c, ...clients]);
    setActiveId(c.id);
    setNewName("");
  };

  const updateClient = (id, patch) => {
    setClients(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  };

  const deleteClient = (id) => {
    if (!confirm("Remove this client? Notes and call history will be lost.")) return;
    setClients(prev => prev.filter(c => c.id !== id));
  };

  const markCheckupDone = (id) => {
    setClients(prev => prev.map(c => {
      if (c.id !== id) return c;
      const completed = c.nextCheckup;
      return {
        ...c,
        nextCheckup: addDays(completed, 14),
        history: [completed, ...(c.history || [])],
      };
    }));
  };

  const rescheduleCheckup = (id, iso) => updateClient(id, { nextCheckup: iso });

  return (
    <div className="app">
      <Header
        view={view} setView={setView}
        count={clients.length}
        syncStatus={sync.status}
        onOpenSync={sync.openShare}
      />
      <main className="main">
        {view === "clients" ? (
          <ClientsView
            clients={clients}
            active={active}
            activeId={activeId}
            setActiveId={setActiveId}
            newName={newName}
            setNewName={setNewName}
            addClient={addClient}
            updateClient={updateClient}
            deleteClient={deleteClient}
            markCheckupDone={markCheckupDone}
            rescheduleCheckup={rescheduleCheckup}
          />
        ) : (
          <CalendarView
            clients={clients}
            markCheckupDone={markCheckupDone}
            rescheduleCheckup={rescheduleCheckup}
            setActiveId={setActiveId}
            setView={setView}
          />
        )}
      </main>

      {sync.showShare && <ShareDialog sync={sync}/>}

      <TweaksPanel title="Tweaks">
        <TweakSection title="Theme">
          <TweakColor
            label="Accent"
            value={tweaks.accent}
            onChange={(v) => setTweak("accent", v)}
            options={["#1FD75F", "#3B82F6", "#10B981", "#EF4444", "#A855F7"]}
          />
          <TweakToggle
            label="Dark mode"
            value={tweaks.darkMode}
            onChange={(v) => setTweak("darkMode", v)}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

// ---------- Header ----------
function Header({ view, setView, count, syncStatus, onOpenSync }) {
  return (
    <header className="header">
      <div className="brand">
        <div className="brand-mark">SBM</div>
        <div>
          <div className="brand-name">Weekly Checkups</div>
          <div className="brand-sub">By Ako &amp; Seb</div>
        </div>
      </div>
      <nav className="nav">
        <button className={"nav-btn " + (view==="clients"?"active":"")} onClick={()=>setView("clients")}>
          Clients <span className="badge">{count}</span>
        </button>
        <button className={"nav-btn " + (view==="calendar"?"active":"")} onClick={()=>setView("calendar")}>
          Calendar
        </button>
      </nav>
      <div className="header-right">
        <button className="sync-chip" onClick={onOpenSync} title="Get share link">
          <span className={"dot " + syncStatus.state}/>
          <span className="sync-label">{syncStatus.label}</span>
          <svg className="sync-share-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M8 1 L8 10 M5 4 L8 1 L11 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M3 8 L3 14 L13 14 L13 8" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </header>
  );
}

// ---------- Clients view ----------
function ClientsView(props) {
  const {
    clients, active, activeId, setActiveId,
    newName, setNewName, addClient, updateClient,
    deleteClient, markCheckupDone, rescheduleCheckup
  } = props;

  return (
    <div className="clients-grid">
      <aside className="sidebar">
        <div className="add-row">
          <input
            className="input"
            placeholder="Add client name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addClient(); }}
          />
          <button className="btn primary" onClick={addClient} aria-label="Add client">+</button>
        </div>

        <div className="list-meta">
          {clients.length} {clients.length===1?"client":"clients"}
        </div>

        <ul className="client-list">
          {clients.length === 0 && (
            <li className="empty">No clients yet. Add your first one above.</li>
          )}
          {clients.map(c => {
            const days = daysBetween(todayISO(), c.nextCheckup);
            let status = "ok";
            if (days < 0) status = "overdue";
            else if (days <= 2) status = "soon";
            return (
              <li
                key={c.id}
                className={"client-item " + (activeId===c.id?"selected":"")}
                onClick={() => setActiveId(c.id)}
              >
                <div className="ci-top">
                  <div className="ci-name">{c.name}</div>
                  <span className={"pill pill-" + status}>
                    {days < 0 ? `${Math.abs(days)}d late`
                      : days === 0 ? "Today"
                      : `${days}d`}
                  </span>
                </div>
                <div className="ci-sub">Next: {fmtDate(c.nextCheckup)}</div>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="detail">
        {!active ? (
          <EmptyState />
        ) : (
          <ClientDetail
            client={active}
            updateClient={updateClient}
            deleteClient={deleteClient}
            markCheckupDone={markCheckupDone}
            rescheduleCheckup={rescheduleCheckup}
          />
        )}
      </section>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="es-mark">
        <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
          <rect x="8" y="12" width="48" height="44" rx="6" fill="none" stroke="currentColor" strokeWidth="2"/>
          <path d="M8 24 H56" stroke="currentColor" strokeWidth="2"/>
          <path d="M20 8 V18 M44 8 V18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </div>
      <h2>Track your clients</h2>
      <p>Add a client on the left to start tracking bi-weekly checkup calls and notes.</p>
    </div>
  );
}

function ClientDetail({ client, updateClient, deleteClient, markCheckupDone, rescheduleCheckup }) {
  const [name, setName] = useState(client.name);
  const [notes, setNotes] = useState(client.notes || "");
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => { setName(client.name); setNotes(client.notes || ""); }, [client.id]);

  // autosave notes
  useEffect(() => {
    if (notes === (client.notes || "")) return;
    const t = setTimeout(() => {
      updateClient(client.id, { notes });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
    }, 400);
    return () => clearTimeout(t);
  }, [notes]);

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== client.name) updateClient(client.id, { name: trimmed });
    else setName(client.name);
  };

  const days = daysBetween(todayISO(), client.nextCheckup);
  let statusText = "On schedule";
  let statusClass = "ok";
  if (days < 0) { statusText = `Overdue by ${Math.abs(days)} day${Math.abs(days)===1?"":"s"}`; statusClass = "overdue"; }
  else if (days === 0) { statusText = "Due today"; statusClass = "soon"; }
  else if (days <= 2) { statusText = `Due in ${days} day${days===1?"":"s"}`; statusClass = "soon"; }
  else statusText = `Due in ${days} days`;

  return (
    <div className="detail-inner">
      <div className="detail-header">
        <input
          className="title-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
        />
        <button className="btn ghost danger" onClick={() => deleteClient(client.id)}>Remove</button>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Client since</div>
          <div className="stat-value">{fmtDate(client.addedOn)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Next checkup</div>
          <div className="stat-value">{fmtDate(client.nextCheckup)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Status</div>
          <div className={"stat-value status-" + statusClass}>
            <span className="status-dot"/> {statusText}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Calls completed</div>
          <div className="stat-value">{(client.history||[]).length}</div>
        </div>
      </div>

      <div className="actions">
        <button className="btn primary" onClick={() => markCheckupDone(client.id)}>
          ✓ Mark checkup complete
        </button>
        <label className="reschedule">
          <span>Reschedule:</span>
          <input
            type="date"
            value={client.nextCheckup}
            onChange={(e) => rescheduleCheckup(client.id, e.target.value)}
            className="input date-input"
          />
        </label>
      </div>

      <div className="notes-block">
        <div className="block-header">
          <h3>Notes</h3>
          <span className={"save-flash " + (savedFlash?"on":"")}>Saved</span>
        </div>
        <textarea
          className="notes"
          placeholder="Anything you want to remember about this client — preferences, last conversation, action items…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {(client.history||[]).length > 0 && (
        <div className="history-block">
          <h3>Call history</h3>
          <ul className="history-list">
            {client.history.map((d, i) => (
              <li key={i}><span className="check">✓</span> {fmtDate(d)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------- Calendar view ----------
function CalendarView({ clients, markCheckupDone, rescheduleCheckup, setActiveId, setView }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });

  const monthDays = useMemo(() => {
    const first = new Date(cursor); first.setDate(1);
    const startWeekday = first.getDay(); // 0 Sun
    const last = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0);
    const total = last.getDate();
    const cells = [];
    // leading blanks
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= total; d++) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), d);
      cells.push(date);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  // upcoming list (next 30 days)
  const upcoming = useMemo(() => {
    const list = clients.map(c => ({
      id: c.id, name: c.name, date: c.nextCheckup,
      days: daysBetween(todayISO(), c.nextCheckup),
    })).sort((a,b) => a.date.localeCompare(b.date));
    return list;
  }, [clients]);

  const clientsOnDay = (date) => {
    if (!date) return [];
    return clients.filter(c => sameDay(c.nextCheckup, date));
  };

  const today = new Date(); today.setHours(0,0,0,0);

  return (
    <div className="calendar-grid">
      <section className="calendar">
        <div className="cal-header">
          <h2>{fmtMonth(cursor)}</h2>
          <div className="cal-nav">
            <button className="btn ghost small" onClick={() => {
              const d = new Date(cursor); d.setMonth(d.getMonth()-1); setCursor(d);
            }}>‹</button>
            <button className="btn ghost small" onClick={() => {
              const d = new Date(); d.setDate(1); setCursor(d);
            }}>Today</button>
            <button className="btn ghost small" onClick={() => {
              const d = new Date(cursor); d.setMonth(d.getMonth()+1); setCursor(d);
            }}>›</button>
          </div>
        </div>

        <div className="cal-grid">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
            <div key={d} className="cal-dow">{d}</div>
          ))}
          {monthDays.map((date, i) => {
            if (!date) return <div key={i} className="cal-cell empty-cell"/>;
            const todays = clientsOnDay(date);
            const isToday = sameDay(date, today);
            const isPast = date < today;
            return (
              <div key={i} className={"cal-cell " + (isToday?"today ":"") + (isPast?"past ":"")}>
                <div className="cal-date">{date.getDate()}</div>
                <div className="cal-events">
                  {todays.slice(0,3).map(c => (
                    <button
                      key={c.id}
                      className="cal-event"
                      onClick={() => { setActiveId(c.id); setView("clients"); }}
                      title={c.name}
                    >
                      <span className="ev-dot"/> {c.name}
                    </button>
                  ))}
                  {todays.length > 3 && (
                    <div className="cal-more">+{todays.length-3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <aside className="upcoming">
        <div className="block-header">
          <h3>Upcoming checkups</h3>
        </div>
        {upcoming.length === 0 ? (
          <p className="empty">No clients yet.</p>
        ) : (
          <ul className="upcoming-list">
            {upcoming.map(u => {
              let cls = "ok";
              if (u.days < 0) cls = "overdue";
              else if (u.days <= 2) cls = "soon";
              return (
                <li key={u.id} className="up-item">
                  <div className="up-left">
                    <div className={"up-date status-" + cls}>
                      <div className="up-mon">{new Date(u.date).toLocaleDateString("en-US",{month:"short"}).toUpperCase()}</div>
                      <div className="up-day">{new Date(u.date).getDate()}</div>
                    </div>
                    <div>
                      <button
                        className="up-name link"
                        onClick={() => { setActiveId(u.id); setView("clients"); }}
                      >{u.name}</button>
                      <div className="up-meta">
                        {u.days < 0 ? `${Math.abs(u.days)} day${Math.abs(u.days)===1?"":"s"} overdue`
                          : u.days === 0 ? "Today"
                          : `in ${u.days} day${u.days===1?"":"s"}`}
                      </div>
                    </div>
                  </div>
                  <button className="btn small primary" onClick={() => markCheckupDone(u.id)}>Done</button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
