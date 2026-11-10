import { useState, useEffect, useCallback } from 'react';

const API = '/api';

export default function App() {
  const [tests, setTests] = useState([]);
  const [url, setUrl] = useState('https://example.com');
  const [testName, setTestName] = useState('');
  const [description, setDescription] = useState('');
  const [browser, setBrowser] = useState('chromium');

  const [recording, setRecording] = useState(null); // { sessionId } when active
  const [recordedCode, setRecordedCode] = useState('');
  const [assertions, setAssertions] = useState([]);

  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const showToast = (msg, type = 'default') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadTests = useCallback(async () => {
    try {
      const res = await fetch(`${API}/tests`);
      const data = await res.json();
      setTests(data.tests || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => { loadTests(); }, [loadTests]);

  // ─── Recording flow ─────────────────────────────────────────────────

  const startRecording = async () => {
    if (!url || !testName) {
      showToast('URL and test name required', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API}/record/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, testName, browser })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRecording({ sessionId: data.sessionId });
      setRecordedCode('');
      showToast('Recording started — interact with the browser', 'success');
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/record/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: recording.sessionId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRecordedCode(data.code || '');
      setRecording(null);
      showToast('Recording captured', 'success');
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error');
      setRecording(null);
    } finally {
      setBusy(false);
    }
  };

  // ─── Assertions ─────────────────────────────────────────────────────

  const addAssertion = () => {
    setAssertions([...assertions, { type: 'visible', selector: '', value: '' }]);
  };

  const updateAssertion = (idx, key, val) => {
    const next = [...assertions];
    next[idx] = { ...next[idx], [key]: val };
    setAssertions(next);
  };

  const removeAssertion = (idx) => {
    setAssertions(assertions.filter((_, i) => i !== idx));
  };

  // ─── Save ───────────────────────────────────────────────────────────

  const saveTest = async () => {
    if (!recordedCode || !testName) {
      showToast('Nothing to save', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API}/tests/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testName,
          code: recordedCode,
          description,
          assertions,
          commitToGit: false
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`Saved to ${data.relativePath}`, 'success');
      setRecordedCode('');
      setAssertions([]);
      setTestName('');
      setDescription('');
      loadTests();
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  // ─── Existing tests ─────────────────────────────────────────────────

  const runTest = async (name) => {
    showToast(`Running ${name}…`);
    try {
      const res = await fetch(`${API}/tests/${name}/run`, { method: 'POST' });
      const data = await res.json();
      showToast(data.passed ? `${name} passed ✓` : `${name} failed ✗`, data.passed ? 'success' : 'error');
    } catch (err) {
      showToast(`Run failed: ${err.message}`, 'error');
    }
  };

  const deleteTest = async (name) => {
    if (!confirm(`Delete test "${name}"?`)) return;
    try {
      await fetch(`${API}/tests/${name}`, { method: 'DELETE' });
      showToast(`Deleted ${name}`, 'success');
      loadTests();
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <div className="eyebrow">Vol. 1 — Issue 01</div>
          <h1>
            The Playwright <span className="ampersand">&</span> Portal
          </h1>
        </div>
        <div className="meta">
          <div><span className="dot"></span>BACKEND ONLINE</div>
          <div>{today}</div>
          <div>{tests.length} TEST{tests.length === 1 ? '' : 'S'} ON FILE</div>
        </div>
      </header>

      <div className="grid">
        {/* ── Left column: Record + save ── */}
        <div>
          <section>
            <div className="section-head">
              <span className="num">I.</span>
              <h2>Capture an interaction</h2>
              <span className="hint">Step 1</span>
            </div>

            <div className="field">
              <label>Test name</label>
              <input
                value={testName}
                onChange={e => setTestName(e.target.value)}
                placeholder="login_happy_path"
                disabled={!!recording}
              />
            </div>

            <div className="field">
              <label>Target URL</label>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://your-app.com/login"
                disabled={!!recording}
              />
            </div>

            <div className="field">
              <label>Description (optional)</label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="A user signs in with valid credentials"
                disabled={!!recording}
              />
            </div>

            <div className="field">
              <label>Browser</label>
              <select value={browser} onChange={e => setBrowser(e.target.value)} disabled={!!recording}>
                <option value="chromium">Chromium</option>
                <option value="firefox">Firefox</option>
                <option value="webkit">WebKit (Safari)</option>
              </select>
            </div>

            <div className={`status-panel ${recording ? 'recording' : ''}`}>
              <div className="label">Status</div>
              <div className="value">
                {recording ? 'Recording in progress…' : 'Ready to record'}
              </div>
              <div className="footnote">
                {recording
                  ? 'A browser window has opened. Click stop when finished.'
                  : 'A real browser will launch when you start.'}
              </div>
            </div>

            <div className="btn-row">
              {!recording ? (
                <button
                  className="btn btn-record"
                  onClick={startRecording}
                  disabled={busy || !testName || !url}
                >
                  ● Start recording
                </button>
              ) : (
                <button className="btn btn-stop" onClick={stopRecording} disabled={busy}>
                  ■ Stop recording
                </button>
              )}
            </div>
          </section>

          {recordedCode && (
            <>
              <div className="divider"></div>
              <section>
                <div className="section-head">
                  <span className="num">II.</span>
                  <h2>Add assertions</h2>
                  <span className="hint">Step 2</span>
                </div>

                {assertions.length === 0 && (
                  <div className="empty" style={{ padding: '20px 0' }}>
                    No assertions yet — recordings capture actions, not checks
                  </div>
                )}

                {assertions.map((a, i) => (
                  <div className="assertion-row" key={i}>
                    <select value={a.type} onChange={e => updateAssertion(i, 'type', e.target.value)}>
                      <option value="visible">is visible</option>
                      <option value="text">has text</option>
                      <option value="url">URL equals</option>
                      <option value="title">title is</option>
                      <option value="count">count is</option>
                    </select>
                    {(a.type !== 'url' && a.type !== 'title') && (
                      <input
                        placeholder="selector e.g. .welcome"
                        value={a.selector}
                        onChange={e => updateAssertion(i, 'selector', e.target.value)}
                      />
                    )}
                    {a.type !== 'visible' && (
                      <input
                        placeholder={a.type === 'url' ? 'https://...' : 'expected value'}
                        value={a.value}
                        onChange={e => updateAssertion(i, 'value', e.target.value)}
                      />
                    )}
                    <button className="remove" onClick={() => removeAssertion(i)}>×</button>
                  </div>
                ))}

                <button className="add-assertion" onClick={addAssertion}>
                  + add assertion
                </button>
              </section>

              <div className="divider"></div>
              <section>
                <div className="section-head">
                  <span className="num">III.</span>
                  <h2>Commit to suite</h2>
                  <span className="hint">Step 3</span>
                </div>
                <div className="btn-row">
                  <button className="btn btn-primary" onClick={saveTest} disabled={busy}>
                    Save test
                  </button>
                  <button className="btn btn-ghost" onClick={() => { setRecordedCode(''); setAssertions([]); }}>
                    Discard
                  </button>
                </div>
              </section>
            </>
          )}
        </div>

        {/* ── Right column: code preview + existing tests ── */}
        <div>
          {recordedCode ? (
            <section>
              <div className="section-head">
                <span className="num">§</span>
                <h2>Generated code</h2>
                <span className="hint">Preview</span>
              </div>
              <pre className="code-block">{highlightCode(recordedCode)}</pre>
            </section>
          ) : (
            <section>
              <div className="section-head">
                <span className="num">§</span>
                <h2>The suite</h2>
                <span className="hint">{tests.length} files</span>
              </div>

              {tests.length === 0 ? (
                <div className="empty">No tests recorded yet</div>
              ) : (
                <ul className="test-list">
                  {tests.map((t, i) => (
                    <li key={t.name}>
                      <div className="index">{String(i + 1).padStart(2, '0')}</div>
                      <div>
                        <div className="test-name">{t.name}</div>
                        <div className="test-meta">
                          {(t.size / 1024).toFixed(1)} KB · {new Date(t.modified).toLocaleString()}
                        </div>
                      </div>
                      <div className="actions">
                        <button className="icon-btn" onClick={() => runTest(t.name)} title="Run test">▶</button>
                        <button className="icon-btn danger" onClick={() => deleteTest(t.name)} title="Delete">×</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>

      {toast && (
        <div className={`toast ${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}

// Naive but readable syntax highlighting for the preview panel.
function highlightCode(code) {
  const keywords = ['import', 'from', 'const', 'let', 'await', 'async', 'function', 'export', 'default', 'return'];
  const tokens = [];
  let i = 0;
  while (i < code.length) {
    // strings
    if (code[i] === "'" || code[i] === '"' || code[i] === '`') {
      const quote = code[i];
      let j = i + 1;
      while (j < code.length && code[j] !== quote) {
        if (code[j] === '\\') j += 2; else j++;
      }
      tokens.push(<span className="str" key={i}>{code.slice(i, j + 1)}</span>);
      i = j + 1;
      continue;
    }
    // line comments
    if (code[i] === '/' && code[i + 1] === '/') {
      let j = i;
      while (j < code.length && code[j] !== '\n') j++;
      tokens.push(<span className="cmt" key={i}>{code.slice(i, j)}</span>);
      i = j;
      continue;
    }
    // keywords
    if (/[a-zA-Z_]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[a-zA-Z0-9_]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (keywords.includes(word)) {
        tokens.push(<span className="kw" key={i}>{word}</span>);
      } else if (code[j] === '(') {
        tokens.push(<span className="fn" key={i}>{word}</span>);
      } else {
        tokens.push(word);
      }
      i = j;
      continue;
    }
    tokens.push(code[i]);
    i++;
  }
  return tokens;
}
