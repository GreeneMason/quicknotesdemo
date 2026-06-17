require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// Trust the nginx reverse proxy so express-rate-limit can read real client IPs
app.set('trust proxy', 1);

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const COOKIE_NAME = process.env.COOKIE_NAME || 'csocial_token';
const POST_TEXT_MAX_LENGTH = 5000;
const LINK_URL_MAX_LENGTH = 2000;
const LINK_TITLE_MAX_LENGTH = 255;
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

// Photo uploads setup
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const photoStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, GIF, WEBP) are allowed'));
    }
  }
});

app.use('/uploads', express.static(UPLOADS_DIR));

// Create connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'csocial_db',
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

const adminMiddleware = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT is_admin FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    if (rows.length === 0 || rows[0].is_admin !== 1) {
      return sendError(res, 403, 'FORBIDDEN', 'Admin access required');
    }
    return next();
  } catch (error) {
    log('error', 'Admin check error', { error: error.message, userId: req.user.id });
    return sendError(res, 500, 'ADMIN_CHECK_FAILED', 'Failed to verify admin status');
  }
};

const postIdMiddleware = (req, res, next) => {
  const postId = Number(req.params.id);

  if (!Number.isInteger(postId) || postId <= 0) {
    return sendError(res, 400, 'INVALID_POST_ID', 'Invalid post id');
  }

  req.postId = postId;
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

const POSTS_RATE_LIMIT_WINDOW_MS = Number(process.env.POSTS_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const POSTS_RATE_LIMIT_MAX = Number(process.env.POSTS_RATE_LIMIT_MAX || 60);

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

const postsRateLimiter = rateLimit({
  windowMs: POSTS_RATE_LIMIT_WINDOW_MS,
  max: POSTS_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please slow down.',
    errorCode: 'POSTS_RATE_LIMITED'
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
app.use('/api/posts', postsRateLimiter);

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

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT is_admin FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    const is_admin = rows.length > 0 ? rows[0].is_admin : 0;
    return sendSuccess(res, 200, { user: { id: req.user.id, email: req.user.email, is_admin } });
  } catch (error) {
    log('error', 'Session check error', { error: error.message, userId: req.user.id });
    return sendError(res, 500, 'SESSION_CHECK_FAILED', 'Failed to verify session');
  }
});

// GET /api/posts — social feed, newest first, with like counts
app.get('/api/posts', authMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const [rows] = await pool.query(
      `SELECT p.id, p.user_id, u.email AS user_email,
              p.text_content, p.photo_url, p.link_url, p.link_title, p.created_at,
              COUNT(DISTINCT l.id) AS like_count,
              SUM(CASE WHEN l.user_id = ? THEN 1 ELSE 0 END) AS liked_by_me
       FROM posts p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN post_likes l ON l.post_id = p.id
       GROUP BY p.id
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );

    return sendSuccess(res, 200, { posts: rows });
  } catch (error) {
    log('error', 'List posts error', { error: error.message, userId: req.user.id });
    return sendError(res, 500, 'LIST_POSTS_FAILED', 'Failed to list posts');
  }
});

// POST /api/posts — create a post (multipart/form-data: text_content, photo, link_url, link_title)
app.post('/api/posts', authMiddleware, (req, res, next) => {
  photoUpload.single('photo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return sendError(res, 400, 'UPLOAD_ERROR', err.message);
    }
    if (err) {
      return sendError(res, 400, 'UPLOAD_ERROR', err.message);
    }
    next();
  });
}, async (req, res) => {
  try {
    const { text_content, link_url, link_title } = req.body;

    if (!text_content && !req.file && !link_url) {
      return sendError(res, 400, 'EMPTY_POST', 'Post must include text, a photo, or a link');
    }

    if (text_content && text_content.length > POST_TEXT_MAX_LENGTH) {
      return sendError(res, 400, 'TEXT_TOO_LONG', `Text must be ${POST_TEXT_MAX_LENGTH} characters or less`);
    }

    if (link_url) {
      if (link_url.length > LINK_URL_MAX_LENGTH) {
        return sendError(res, 400, 'LINK_TOO_LONG', 'Link URL is too long');
      }
      try {
        new URL(link_url);
      } catch {
        return sendError(res, 400, 'INVALID_LINK_URL', 'Link URL is not a valid URL');
      }
    }

    if (link_title && link_title.length > LINK_TITLE_MAX_LENGTH) {
      return sendError(res, 400, 'LINK_TITLE_TOO_LONG', `Link title must be ${LINK_TITLE_MAX_LENGTH} characters or less`);
    }

    const photo_url = req.file ? `/uploads/${req.file.filename}` : null;
    const [result] = await pool.query(
      'INSERT INTO posts (user_id, text_content, photo_url, link_url, link_title) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, text_content || null, photo_url, link_url || null, link_title || null]
    );

    const [rows] = await pool.query(
      `SELECT p.id, p.user_id, u.email AS user_email,
              p.text_content, p.photo_url, p.link_url, p.link_title, p.created_at,
              0 AS like_count, 0 AS liked_by_me
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = ?`,
      [result.insertId]
    );

    return sendSuccess(res, 201, { post: rows[0] });
  } catch (error) {
    log('error', 'Create post error', { error: error.message, userId: req.user.id });
    return sendError(res, 500, 'CREATE_POST_FAILED', 'Failed to create post');
  }
});

// DELETE /api/posts/:id — delete own post
app.delete('/api/posts/:id', authMiddleware, postIdMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT user_id, photo_url FROM posts WHERE id = ? LIMIT 1',
      [req.postId]
    );

    if (rows.length === 0) {
      return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found');
    }

    if (rows[0].user_id !== req.user.id) {
      return sendError(res, 403, 'FORBIDDEN', 'You can only delete your own posts');
    }

    if (rows[0].photo_url) {
      const filePath = path.join(__dirname, rows[0].photo_url);
      fs.unlink(filePath, (err) => {
        if (err) log('warn', 'Could not delete photo file', { path: filePath, error: err.message });
      });
    }

    await pool.query('DELETE FROM posts WHERE id = ?', [req.postId]);
    return sendSuccess(res, 200, { id: req.postId });
  } catch (error) {
    log('error', 'Delete post error', { error: error.message, userId: req.user.id, postId: req.postId });
    return sendError(res, 500, 'DELETE_POST_FAILED', 'Failed to delete post');
  }
});

// POST /api/posts/:id/like — toggle like/unlike
app.post('/api/posts/:id/like', authMiddleware, postIdMiddleware, async (req, res) => {
  try {
    const [postRows] = await pool.query(
      'SELECT id FROM posts WHERE id = ? LIMIT 1',
      [req.postId]
    );

    if (postRows.length === 0) {
      return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found');
    }

    const [existing] = await pool.query(
      'SELECT id FROM post_likes WHERE post_id = ? AND user_id = ? LIMIT 1',
      [req.postId, req.user.id]
    );

    let liked;
    if (existing.length > 0) {
      await pool.query('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [req.postId, req.user.id]);
      liked = false;
    } else {
      await pool.query('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)', [req.postId, req.user.id]);
      liked = true;
    }

    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS count FROM post_likes WHERE post_id = ?',
      [req.postId]
    );
    return sendSuccess(res, 200, { liked, like_count: Number(countRows[0].count) });
  } catch (error) {
    log('error', 'Like post error', { error: error.message, userId: req.user.id, postId: req.postId });
    return sendError(res, 500, 'LIKE_POST_FAILED', 'Failed to toggle like');
  }
});

// GET /api/posts/:id/comments — list comments for a post
app.get('/api/posts/:id/comments', authMiddleware, postIdMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.post_id, c.user_id, c.text_content, c.created_at, u.email AS user_email
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ?
       ORDER BY c.created_at ASC`,
      [req.postId]
    );
    return sendSuccess(res, 200, { comments: rows });
  } catch (error) {
    log('error', 'List comments error', { error: error.message, userId: req.user.id });
    return sendError(res, 500, 'LIST_COMMENTS_FAILED', 'Failed to list comments');
  }
});

// POST /api/posts/:id/comments — add a comment
app.post('/api/posts/:id/comments', authMiddleware, postIdMiddleware, async (req, res) => {
  const text = (req.body.text_content || '').trim();
  if (!text) return sendError(res, 400, 'EMPTY_COMMENT', 'Comment cannot be empty');
  if (text.length > 1000) return sendError(res, 400, 'COMMENT_TOO_LONG', 'Comment must be 1000 characters or fewer');
  try {
    const [result] = await pool.query(
      'INSERT INTO comments (post_id, user_id, text_content) VALUES (?, ?, ?)',
      [req.postId, req.user.id, text]
    );
    const [rows] = await pool.query(
      `SELECT c.id, c.post_id, c.user_id, c.text_content, c.created_at, u.email AS user_email
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.id = ?`,
      [result.insertId]
    );
    return sendSuccess(res, 201, { comment: rows[0] });
  } catch (error) {
    log('error', 'Create comment error', { error: error.message, userId: req.user.id });
    return sendError(res, 500, 'CREATE_COMMENT_FAILED', 'Failed to create comment');
  }
});

// DELETE /api/comments/:id — delete own comment
app.delete('/api/comments/:id', authMiddleware, async (req, res) => {
  const commentId = parseInt(req.params.id, 10);
  if (!Number.isInteger(commentId) || commentId < 1) {
    return sendError(res, 400, 'INVALID_COMMENT_ID', 'Invalid comment ID');
  }
  try {
    const [rows] = await pool.query('SELECT id, user_id FROM comments WHERE id = ? LIMIT 1', [commentId]);
    if (rows.length === 0) return sendError(res, 404, 'COMMENT_NOT_FOUND', 'Comment not found');
    if (rows[0].user_id !== req.user.id && !req.user.is_admin) {
      return sendError(res, 403, 'FORBIDDEN', 'You cannot delete this comment');
    }
    await pool.query('DELETE FROM comments WHERE id = ?', [commentId]);
    return sendSuccess(res, 200, { id: commentId });
  } catch (error) {
    log('error', 'Delete comment error', { error: error.message, userId: req.user.id });
    return sendError(res, 500, 'DELETE_COMMENT_FAILED', 'Failed to delete comment');
  }
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, email, is_admin, created_at FROM users ORDER BY created_at ASC'
    );
    return sendSuccess(res, 200, { users: rows });
  } catch (error) {
    log('error', 'List users error', { error: error.message, userId: req.user.id });
    return sendError(res, 500, 'LIST_USERS_FAILED', 'Failed to list users');
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
    log('info', `C-Social server running on http://${HOST}:${PORT}`);
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
