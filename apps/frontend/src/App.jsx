import React, { useState, useEffect, useRef } from 'react';
import './App.css';

function PostCard({ post, currentUserId, onLike, onDelete }) {
  const displayName = post.user_email.split('@')[0];
  const isOwn = post.user_id === currentUserId;

  return (
    <article className="post-card">
      <header className="post-header">
        <div className="post-avatar">{displayName[0].toUpperCase()}</div>
        <div className="post-meta">
          <span className="post-username">{displayName}</span>
          <span className="post-time">{new Date(post.created_at).toLocaleString()}</span>
        </div>
        {isOwn && (
          <button
            className="post-delete-btn"
            onClick={() => onDelete(post.id)}
            title="Delete post"
            type="button"
          >
            ✕
          </button>
        )}
      </header>

      {post.text_content && (
        <p className="post-text">{post.text_content}</p>
      )}

      {post.photo_url && (
        <div className="post-photo-wrap">
          <img src={post.photo_url} alt="Post photo" className="post-photo" />
        </div>
      )}

      {post.link_url && (
        <a
          href={post.link_url}
          target="_blank"
          rel="noopener noreferrer"
          className="post-link-card"
        >
          <span className="link-icon">🔗</span>
          <div className="link-text">
            {post.link_title && <span className="link-title">{post.link_title}</span>}
            <span className="link-url">{post.link_url}</span>
          </div>
        </a>
      )}

      <footer className="post-footer">
        <button
          className={`like-btn ${post.liked_by_me ? 'liked' : ''}`}
          onClick={() => onLike(post.id)}
          type="button"
        >
          ♥{post.like_count > 0 ? ` ${post.like_count}` : ''}
        </button>
      </footer>
    </article>
  );
}

function CreatePostForm({ onPostCreated }) {
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [showLinkFields, setShowLinkFields] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const clearPhoto = () => {
    setPhoto(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim() && !photo && !linkUrl.trim()) {
      setError('Add some text, a photo, or a link before posting.');
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const formData = new FormData();
      if (text.trim()) formData.append('text_content', text.trim());
      if (photo) formData.append('photo', photo);
      if (linkUrl.trim()) formData.append('link_url', linkUrl.trim());
      if (linkTitle.trim()) formData.append('link_title', linkTitle.trim());

      const response = await fetch('/api/posts', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Failed to create post');

      setText('');
      clearPhoto();
      setLinkUrl('');
      setLinkTitle('');
      setShowLinkFields(false);
      onPostCreated(payload.data.post);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="create-post-form" onSubmit={handleSubmit}>
      <textarea
        className="post-textarea"
        placeholder="What's on your mind?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
      />

      {photoPreview && (
        <div className="photo-preview-wrap">
          <img src={photoPreview} alt="Preview" className="photo-preview" />
          <button type="button" className="remove-photo-btn" onClick={clearPhoto}>✕</button>
        </div>
      )}

      {showLinkFields && (
        <div className="link-fields">
          <input
            type="url"
            className="input"
            placeholder="https://example.com"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
          />
          <input
            type="text"
            className="input"
            placeholder="Link title (optional)"
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            maxLength={255}
          />
        </div>
      )}

      <div className="form-actions">
        <div className="attachment-buttons">
          <button
            type="button"
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Add photo"
          >
            📷
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            style={{ display: 'none' }}
            onChange={handlePhotoChange}
          />
          <button
            type="button"
            className={`attach-btn ${showLinkFields ? 'active' : ''}`}
            onClick={() => setShowLinkFields((v) => !v)}
            title="Add link"
          >
            🔗
          </button>
        </div>
        <button className="button post-btn" type="submit" disabled={submitting}>
          {submitting ? 'Posting...' : 'Post'}
        </button>
      </div>

      {error && (
        <div className="error-box" role="alert">
          <strong>Error:</strong> {error}
        </div>
      )}
    </form>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [view, setView] = useState('feed');
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState(null);

  const readApiPayload = async (response, fallbackError) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || fallbackError);
    if (payload && payload.success === true && payload.data !== undefined) return payload.data;
    return payload;
  };

  useEffect(() => {
    fetchSession();
  }, []);

  const fetchSession = async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (!response.ok) { setUser(null); setLoading(false); return; }
      const data = await readApiPayload(response, 'Unable to verify session');
      setUser(data.user);
      setError(null);
      await loadFeed();
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
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      const data = await readApiPayload(response, 'Authentication failed');
      setUser(data.user);
      setEmail('');
      setPassword('');
      await loadFeed();
    } catch (err) {
      setError(err.message);
      console.error('Auth submit error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      setUser(null);
      setPosts([]);
    } catch {
      setError('Unable to logout right now');
    }
  };

  const loadFeed = async () => {
    setPostsLoading(true);
    try {
      const response = await fetch('/api/posts', { credentials: 'include' });
      const data = await readApiPayload(response, 'Failed to load posts');
      setPosts(data.posts || []);
    } catch (err) {
      setError(err.message);
      console.error('Load feed error:', err);
    } finally {
      setPostsLoading(false);
    }
  };

  const handlePostCreated = (newPost) => {
    setPosts((prev) => [newPost, ...prev]);
  };

  const handleLike = async (postId) => {
    try {
      const response = await fetch(`/api/posts/${postId}/like`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await readApiPayload(response, 'Failed to like post');
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, liked_by_me: data.liked ? 1 : 0, like_count: data.like_count }
            : p
        )
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (postId) => {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    try {
      const response = await fetch(`/api/posts/${postId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      await readApiPayload(response, 'Failed to delete post');
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (err) {
      setError(err.message);
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

  if (loading) {
    return (
      <div className="App">
        <div className="loading-screen">
          <div className="brand-mark">C#</div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (user) {
    return (
      <div className="App app-feed">
        <header className="top-bar">
          <div className="top-bar-inner">
            <div className="brand">
              <span className="brand-mark">C#</span>
              <span className="brand-name">C-Social</span>
            </div>
            <nav className="top-nav">
              {user.is_admin === 1 && (
                <>
                  <button
                    className={`nav-btn ${view === 'feed' ? 'active' : ''}`}
                    onClick={() => setView('feed')}
                    type="button"
                  >
                    Feed
                  </button>
                  <button
                    className={`nav-btn ${view === 'admin' ? 'active' : ''}`}
                    onClick={handleViewAdmin}
                    type="button"
                  >
                    Admin
                  </button>
                </>
              )}
            </nav>
            <div className="top-bar-user">
              <span className="top-bar-email">{user.email}</span>
              <button className="logout-btn" onClick={handleLogout} type="button">
                Logout
              </button>
            </div>
          </div>
        </header>

        <main className="feed-main">
          {view === 'admin' ? (
            <div className="card admin-panel">
              <h2>All Users</h2>
              {adminLoading && <p className="muted">Loading users...</p>}
              {adminError && <div className="error-box" role="alert"><strong>Error:</strong> {adminError}</div>}
              {!adminLoading && !adminError && (
                <table className="users-table">
                  <thead>
                    <tr><th>ID</th><th>Email</th><th>Admin</th><th>Joined</th></tr>
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
              <div className="card create-post-card">
                <CreatePostForm onPostCreated={handlePostCreated} />
              </div>

              {error && (
                <div className="error-box feed-error" role="alert">
                  <strong>Error:</strong> {error}
                  <button type="button" className="dismiss-btn" onClick={() => setError(null)}>✕</button>
                </div>
              )}

              {postsLoading && <p className="muted feed-status">Loading feed...</p>}
              {!postsLoading && posts.length === 0 && (
                <p className="muted feed-status">No posts yet. Be the first to share something!</p>
              )}

              <div className="posts-feed">
                {posts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    currentUserId={user.id}
                    onLike={handleLike}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="App">
      <main className="shell">
        <section className="card auth-card">
          <div className="auth-brand">
            <span className="brand-mark">C#</span>
            <h1 className="brand-title">C-Social</h1>
          </div>
          <p className="muted">Connect. Share. Code.</p>

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
              ? 'Welcome back! Log in to see your feed.'
              : 'Join C-Social and start sharing.'}
          </p>
        </section>
      </main>
    </div>
  );
}

export default App;
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState(null);



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



  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });

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









