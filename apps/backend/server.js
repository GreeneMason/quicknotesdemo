require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const app = express();

// Trust the nginx reverse proxy so express-rate-limit can read real client IPs
app.set('trust proxy', 1);

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const COOKIE_NAME = process.env.COOKIE_NAME || 'quicknotes_token';
const NOTE_TITLE_MAX_LENGTH = 255;
const NOTE_BODY_MAX_LENGTH = 20000;
const AUTH_RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX || 20);

const log = (level, message, meta = {}) => {
  const entry = { time: new Date().toISOString(), level, message, ...meta };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
};

// Production startup guard — fail fast rather than run with insecure defaults
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me-in-production') {
    log('error', 'FATAL: JWT_SECRET must be set to a strong secret in production. Set it in .env.');
    process.exit(1);
  }
  if (!process.env.FRONTEND_ORIGIN) {
    log('error', 'FATAL: FRONTEND_ORIGIN must be set in production. Set it in .env.');
    process.exit(1);
  }
}

// Middleware
app.use(cors({
  // In production FRONTEND_ORIGIN is guaranteed set by the guard above.
  // In development fall back to allowing all origins for convenience.
  origin: process.env.FRONTEND_ORIGIN || (process.env.NODE_ENV === 'production' ? false : true),
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Create connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'fullstack_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const getCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
  maxAge: 7 * 24 * 60 * 60 * 1000
});

const signToken = (user) => jwt.sign(
  { id: user.id, email: user.email },
  JWT_SECRET,
  { expiresIn: '7d' }
);

const authMiddleware = (req, res, next) => {
  const token = req.cookies[COOKIE_NAME];

  if (!token) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Unauthorized');
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (error) {
    return sendError(res, 401, 'INVALID_SESSION', 'Invalid session');
  }
};

const noteIdMiddleware = (req, res, next) => {
  const noteId = Number(req.params.id);

  if (!Number.isInteger(noteId) || noteId <= 0) {
    return sendError(res, 400, 'INVALID_NOTE_ID', 'Invalid note id');
  }

  req.noteId = noteId;
  return next();
};

const validateNotePayload = (req, res, next) => {
  const { title, body } = req.body || {};

  if (typeof title !== 'string' || typeof body !== 'string') {
    return sendError(res, 400, 'INVALID_NOTE_PAYLOAD', 'Title and body are required strings');
  }

  const trimmedTitle = title.trim() || 'Untitled Note';

  if (trimmedTitle.length > NOTE_TITLE_MAX_LENGTH) {
    return sendError(
      res,
      400,
      'TITLE_TOO_LONG',
      `Title must be ${NOTE_TITLE_MAX_LENGTH} characters or less`
    );
  }

  if (body.length > NOTE_BODY_MAX_LENGTH) {
    return sendError(
      res,
      400,
      'BODY_TOO_LONG',
      `Body must be ${NOTE_BODY_MAX_LENGTH} characters or less`
    );
  }

  req.notePayload = {
    title: trimmedTitle,
    body
  };

  return next();
};

const sendSuccess = (res, statusCode, data) => res.status(statusCode).json({ success: true, data });

const sendError = (res, statusCode, code, message) => {
  return res.status(statusCode).json({
    success: false,
    error: message,
    errorCode: code
  });
};

const NOTES_RATE_LIMIT_WINDOW_MS = Number(process.env.NOTES_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const NOTES_RATE_LIMIT_MAX = Number(process.env.NOTES_RATE_LIMIT_MAX || 120);

const authRateLimiter = rateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again later.',
    errorCode: 'AUTH_RATE_LIMITED'
  },
  handler: (req, res, next, options) => {
    log('warn', 'Auth rate limit exceeded', { ip: req.ip, path: req.path });
    return res.status(options.statusCode).json(options.message);
  }
});

const notesRateLimiter = rateLimit({
  windowMs: NOTES_RATE_LIMIT_WINDOW_MS,
  max: NOTES_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please slow down.',
    errorCode: 'NOTES_RATE_LIMITED'
  }
});

// Test database connection
pool.getConnection()
  .then(conn => {
    console.log('Connected to MySQL database');
    conn.release();
  })
  .catch(err => {
    console.error('Database connection failed:', err.message);
    console.log('Make sure MySQL is running and the database is created.');
  });

// Routes
app.use('/api/notes', notesRateLimiter);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/auth/register', authRateLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return sendError(res, 400, 'EMAIL_PASSWORD_REQUIRED', 'Email and password are required');
  }

  if (!EMAIL_REGEX.test(email)) {
    return sendError(res, 400, 'INVALID_EMAIL', 'Invalid email address');
  }

  if (password.length < 8) {
    return sendError(res, 400, 'PASSWORD_TOO_SHORT', 'Password must be at least 8 characters');
  }

  try {
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    if (existing.length > 0) {
      log('warn', 'Register failed: email already registered', { email });
      return sendError(res, 409, 'EMAIL_ALREADY_REGISTERED', 'Email already registered');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (email, hashed_password) VALUES (?, ?)',
      [email, hashedPassword]
    );

    const user = { id: result.insertId, email };
    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, getCookieOptions());

    return sendSuccess(res, 201, { user });
  } catch (error) {
    log('error', 'Register error', { error: error.message, email });
    return sendError(res, 500, 'REGISTER_FAILED', 'Failed to register user');
  }
});

app.post('/api/auth/login', authRateLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return sendError(res, 400, 'EMAIL_PASSWORD_REQUIRED', 'Email and password are required');
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, email, hashed_password FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    if (rows.length === 0) {
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const userRecord = rows[0];
    const passwordMatches = await bcrypt.compare(password, userRecord.hashed_password);

    if (!passwordMatches) {
      log('warn', 'Login failed: invalid password', { email });
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const user = { id: userRecord.id, email: userRecord.email };
    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, getCookieOptions());

    return sendSuccess(res, 200, { user });
  } catch (error) {
    log('error', 'Login error', { error: error.message, email });
    return sendError(res, 500, 'LOGIN_FAILED', 'Failed to login');
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, getCookieOptions());
  return sendSuccess(res, 200, { loggedOut: true });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  return sendSuccess(res, 200, { user: { id: req.user.id, email: req.user.email } });
});

app.get('/api/notes', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, updated_at
       FROM notes
       WHERE user_id = ?
       ORDER BY updated_at DESC`,
      [req.user.id]
    );

    return sendSuccess(res, 200, { notes: rows });
  } catch (error) {
    log('error', 'List notes error', { error: error.message, userId: req.user.id });
    return sendError(res, 500, 'LIST_NOTES_FAILED', 'Failed to list notes');
  }
});

app.get('/api/notes/:id', authMiddleware, noteIdMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, user_id, title, body, updated_at, created_at
       FROM notes
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [req.noteId, req.user.id]
    );

    if (rows.length === 0) {
      return sendError(res, 404, 'NOTE_NOT_FOUND', 'Note not found');
    }

    const note = rows[0];
    delete note.user_id;
    return sendSuccess(res, 200, { note });
  } catch (error) {
    log('error', 'Get note error', { error: error.message, userId: req.user.id, noteId: req.noteId });
    return sendError(res, 500, 'GET_NOTE_FAILED', 'Failed to get note');
  }
});

app.post('/api/notes', authMiddleware, validateNotePayload, async (req, res) => {
  try {
    const [result] = await pool.query(
      'INSERT INTO notes (user_id, title, body) VALUES (?, ?, ?)',
      [req.user.id, req.notePayload.title, req.notePayload.body]
    );

    const [rows] = await pool.query(
      `SELECT id, title, body, updated_at, created_at
       FROM notes
       WHERE id = ?
       LIMIT 1`,
      [result.insertId]
    );

    return sendSuccess(res, 201, { note: rows[0] });
  } catch (error) {
    log('error', 'Create note error', { error: error.message, userId: req.user.id });
    return sendError(res, 500, 'CREATE_NOTE_FAILED', 'Failed to create note');
  }
});

app.put('/api/notes/:id', authMiddleware, noteIdMiddleware, validateNotePayload, async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE notes
       SET title = ?, body = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [req.notePayload.title, req.notePayload.body, req.noteId, req.user.id]
    );

    if (result.affectedRows === 0) {
      return sendError(res, 404, 'NOTE_NOT_FOUND', 'Note not found');
    }

    const [rows] = await pool.query(
      `SELECT id, title, body, updated_at, created_at
       FROM notes
       WHERE id = ?
       LIMIT 1`,
      [req.noteId]
    );

    return sendSuccess(res, 200, { note: rows[0] });
  } catch (error) {
    log('error', 'Update note error', { error: error.message, userId: req.user.id, noteId: req.noteId });
    return sendError(res, 500, 'UPDATE_NOTE_FAILED', 'Failed to update note');
  }
});

app.delete('/api/notes/:id', authMiddleware, noteIdMiddleware, async (req, res) => {
  try {
    const [result] = await pool.query(
      'DELETE FROM notes WHERE id = ? AND user_id = ?',
      [req.noteId, req.user.id]
    );

    if (result.affectedRows === 0) {
      return sendError(res, 404, 'NOTE_NOT_FOUND', 'Note not found');
    }

    return sendSuccess(res, 200, { id: req.noteId });
  } catch (error) {
    log('error', 'Delete note error', { error: error.message, userId: req.user.id, noteId: req.noteId });
    return sendError(res, 500, 'DELETE_NOTE_FAILED', 'Failed to delete note');
  }
});

app.use('/api', (req, res) => {
  return sendError(res, 404, 'ROUTE_NOT_FOUND', 'Route not found');
});

app.use((req, res) => {
  return sendError(res, 404, 'ROUTE_NOT_FOUND', 'Route not found');
});

// Centralized error handler. Must be last app.use with four args.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  log('error', 'Unhandled server error', {
    method: req.method,
    path: req.path,
    error: err.message
  });
  return sendError(res, 500, 'UNEXPECTED_ERROR', 'An unexpected error occurred');
});

let server;

if (require.main === module) {
  server = app.listen(PORT, HOST, () => {
    log('info', `Server running on http://${HOST}:${PORT}`);
  });

  const shutdown = (signal) => {
    log('info', `${signal} received — shutting down gracefully`);
    server.close(() => {
      pool.end().finally(() => {
        log('info', 'Server and DB pool closed');
        process.exit(0);
      });
    });
    // Force exit if graceful shutdown takes too long
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = {
  app,
  pool,
  server
};
