import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [editorTitle, setEditorTitle] = useState('');
  const [editorBody, setEditorBody] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);
  const [saveState, setSaveState] = useState('saved');
  const [view, setView] = useState('notes');
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState(null);

  const parseJsonSafe = async (response) => {
    return response.json().catch(() => ({}));
  };

  const readApiPayload = async (response, fallbackError) => {
    const payload = await parseJsonSafe(response);

    if (!response.ok) {
      throw new Error(payload.error || fallbackError);
    }

    if (payload && payload.success === true && payload.data !== undefined) {
      return payload.data;
    }

    return payload;
  };

  // Check if an auth cookie is already present.
  useEffect(() => {
    fetchSession();
  }, []);

  const fetchSession = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include'
      });

      if (!response.ok) {
        setUser(null);
        setLoading(false);
        return;
      }

      const data = await readApiPayload(response, 'Unable to verify session right now');
      setUser(data.user);
      setError(null);
      loadNotes();
    } catch (err) {
      setError('Unable to verify session right now');
      console.error('Session check error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });

      const data = await readApiPayload(response, 'Authentication failed');
      setUser(data.user);
      setEmail('');
      setPassword('');
      await loadNotes();
    } catch (err) {
      setError(err.message);
      console.error('Auth submit error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      setUser(null);
      setNotes([]);
      setSelectedNoteId(null);
      setEditorTitle('');
      setEditorBody('');
      setEditorDirty(false);
    } catch (err) {
      setError('Unable to logout right now');
      console.error('Logout error:', err);
    }
  };

  const handleViewAdmin = async () => {
    setView('admin');
    setAdminError(null);
    setAdminLoading(true);
    try {
      const response = await fetch('/api/admin/users', { credentials: 'include' });
      const data = await readApiPayload(response, 'Failed to load users');
      setAdminUsers(data.users || []);
    } catch (err) {
      setAdminError(err.message);
    } finally {
      setAdminLoading(false);
    }
  };

  const loadNotes = async () => {
    setNotesLoading(true);
    try {
      const response = await fetch('/api/notes', {
        credentials: 'include'
      });

      const data = await readApiPayload(response, 'Failed to load notes');
      const list = data.notes || [];
      setNotes(list);

      if (list.length === 0) {
        setSelectedNoteId(null);
        setEditorTitle('');
        setEditorBody('');
        setEditorDirty(false);
        setSaveState('saved');
        return;
      }

      const hasCurrentSelection = list.some((note) => note.id === selectedNoteId);
      const targetId = hasCurrentSelection ? selectedNoteId : list[0].id;
      await loadNote(targetId);
    } catch (err) {
      setError(err.message);
      console.error('Load notes error:', err);
    } finally {
      setNotesLoading(false);
    }
  };

  const loadNote = async (noteId) => {
    const response = await fetch(`/api/notes/${noteId}`, {
      credentials: 'include'
    });

    const data = await readApiPayload(response, 'Failed to load note');
    const note = data.note;
    setSelectedNoteId(note.id);
    setEditorTitle(note.title || 'Untitled Note');
    setEditorBody(note.body || '');
    setEditorDirty(false);
    setSaveState('saved');
  };

  const handleSelectNote = async (noteId) => {
    if (noteId === selectedNoteId) return;
    try {
      setError(null);
      await loadNote(noteId);
    } catch (err) {
      setError(err.message);
      console.error('Select note error:', err);
    }
  };

  const handleCreateNote = async () => {
    try {
      setError(null);
      const response = await fetch('/api/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ title: 'Untitled Note', body: '' })
      });

      const data = await readApiPayload(response, 'Failed to create note');
      const note = data.note;
      const summary = {
        id: note.id,
        title: note.title,
        updated_at: note.updated_at
      };
      setNotes((prev) => [summary, ...prev]);
      setSelectedNoteId(note.id);
      setEditorTitle(note.title || 'Untitled Note');
      setEditorBody(note.body || '');
      setEditorDirty(false);
      setSaveState('saved');
    } catch (err) {
      setError(err.message);
      console.error('Create note error:', err);
    }
  };

  const handleDeleteNote = async () => {
    if (!selectedNoteId) return;

    const confirmed = window.confirm('Delete this note? This cannot be undone.');
    if (!confirmed) return;

    try {
      setError(null);
      const response = await fetch(`/api/notes/${selectedNoteId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      await readApiPayload(response, 'Failed to delete note');

      const nextNotes = notes.filter((note) => note.id !== selectedNoteId);
      setNotes(nextNotes);

      if (nextNotes.length === 0) {
        setSelectedNoteId(null);
        setEditorTitle('');
        setEditorBody('');
        setEditorDirty(false);
        setSaveState('saved');
        return;
      }

      await loadNote(nextNotes[0].id);
    } catch (err) {
      setError(err.message);
      console.error('Delete note error:', err);
    }
  };

  useEffect(() => {
    if (!user || !selectedNoteId || !editorDirty) return;

    setSaveState('saving');
    const timeoutId = setTimeout(async () => {
      try {
        const response = await fetch(`/api/notes/${selectedNoteId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            title: editorTitle,
            body: editorBody
          })
        });

        const data = await readApiPayload(response, 'Failed to save note');
        const updated = data.note;
        setNotes((prev) => {
          const updatedList = prev.map((note) => (
            note.id === updated.id
              ? { id: updated.id, title: updated.title, updated_at: updated.updated_at }
              : note
          ));
          updatedList.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
          return updatedList;
        });
        setEditorDirty(false);
        setSaveState('saved');
      } catch (err) {
        setSaveState('error');
        setError(err.message);
        console.error('Autosave error:', err);
      }
    }, 700);

    return () => clearTimeout(timeoutId);
  }, [user, selectedNoteId, editorTitle, editorBody, editorDirty]);

  // Keyboard shortcuts: Ctrl/Cmd+N = new note
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!user) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        handleCreateNote();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (loading) {
    return (
      <div className="App">
        <main className="shell centered-card">
          <p className="status-text">Checking session...</p>
        </main>
      </div>
    );
  }

  if (user) {
    return (
      <div className="App">
        <main className="dashboard-shell">
          <aside className="notes-sidebar">
            <div className="sidebar-header">
              <h1>QuickNotes</h1>
              <p className="muted small">{user.email}</p>
            </div>

            {user.is_admin === 1 && (
              <div className="view-nav">
                <button
                  className={`toggle-button ${view === 'notes' ? 'active' : ''}`}
                  onClick={() => setView('notes')}
                  type="button"
                >
                  Notes
                </button>
                <button
                  className={`toggle-button ${view === 'admin' ? 'active' : ''}`}
                  onClick={handleViewAdmin}
                  type="button"
                >
                  Admin
                </button>
              </div>
            )}

            <div className="sidebar-actions">
              <button className="button small-button" onClick={handleCreateNote} type="button">
                New Note
              </button>
              <button
                className="button secondary-button small-button"
                onClick={handleDeleteNote}
                type="button"
                disabled={!selectedNoteId}
              >
                Delete Note
              </button>
            </div>

            <div className="notes-list">
              {notesLoading && <p className="muted">Loading notes...</p>}
              {!notesLoading && notes.length === 0 && (
                <p className="muted">No notes yet. Create your first one.</p>
              )}

              {notes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className={`note-list-item ${note.id === selectedNoteId ? 'active' : ''}`}
                  onClick={() => handleSelectNote(note.id)}
                >
                  <span className="note-title">{note.title}</span>
                  <span className="note-date">{new Date(note.updated_at).toLocaleString()}</span>
                </button>
              ))}
            </div>

            <button className="button logout-button" onClick={handleLogout} type="button">Logout</button>
          </aside>

          <section className="editor-panel">
            {view === 'admin' ? (
              <div className="admin-panel">
                <h2>All Users</h2>
                {adminLoading && <p className="muted">Loading users...</p>}
                {adminError && (
                  <div className="error-box" role="alert">
                    <strong>Error:</strong> {adminError}
                  </div>
                )}
                {!adminLoading && !adminError && (
                  <table className="users-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Email</th>
                        <th>Admin</th>
                        <th>Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminUsers.map((u) => (
                        <tr key={u.id}>
                          <td>{u.id}</td>
                          <td>{u.email}</td>
                          <td>{u.is_admin === 1 ? 'Yes' : 'No'}</td>
                          <td>{new Date(u.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              <>
                {selectedNoteId ? (
                  <>
                    <div className="editor-top">
                      <input
                        className="editor-title-input"
                        value={editorTitle}
                        onChange={(e) => {
                          setEditorTitle(e.target.value);
                          setEditorDirty(true);
                        }}
                        placeholder="Untitled Note"
                      />
                      <span className={`save-state ${saveState}`}> 
                        {saveState === 'saving' && 'Saving...'}
                        {saveState === 'saved' && 'Saved'}
                        {saveState === 'error' && 'Save failed'}
                      </span>
                    </div>
                    <textarea
                      className="editor-body-input"
                      value={editorBody}
                      onChange={(e) => {
                        setEditorBody(e.target.value);
                        setEditorDirty(true);
                      }}
                      placeholder="Start typing your note..."
                    />
                  </>
                ) : (
                  <div className="empty-editor">
                    <h2>No note selected</h2>
                    <p>Create a note to start writing.</p>
                  </div>
                )}

                {error && (
                  <div className="error-box" role="alert">
                    <strong>Error:</strong> {error}
                  </div>
                )}
              </>
            )}
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="App">
      <main className="shell">
        <section className="card">
          <h1>QuickNotes</h1>
          <p className="muted">Minimalist notes with secure login</p>

          <div className="mode-toggle">
            <button
              className={`toggle-button ${mode === 'login' ? 'active' : ''}`}
              onClick={() => setMode('login')}
              type="button"
            >
              Login
            </button>
            <button
              className={`toggle-button ${mode === 'register' ? 'active' : ''}`}
              onClick={() => setMode('register')}
              type="button"
            >
              Register
            </button>
          </div>

          <form className="form" onSubmit={handleAuthSubmit}>
            <label className="field-label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="input"
              autoComplete="email"
              required
            />

            <label className="field-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="input"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />

            <button className="button" type="submit" disabled={submitting}>
              {submitting ? 'Working...' : mode === 'login' ? 'Login' : 'Create Account'}
            </button>
          </form>

        {error && (
          <div className="error-box" role="alert">
            <strong>Error:</strong> {error}
          </div>
        )}

          <p className="helper-text">
            {mode === 'login'
              ? 'Use your account credentials to continue.'
              : 'Create an account to start taking notes.'}
          </p>
        </section>
      </main>
    </div>
  );
}

export default App;
