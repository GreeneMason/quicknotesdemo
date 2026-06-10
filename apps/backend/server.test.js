const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_USER = process.env.DB_USER || 'root';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'root';
process.env.DB_NAME = process.env.DB_NAME || 'csocial_db_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.COOKIE_NAME = process.env.COOKIE_NAME || 'csocial_test_token';
process.env.AUTH_RATE_LIMIT_MAX = process.env.AUTH_RATE_LIMIT_MAX || '1000';
process.env.FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

const DB_CONFIG = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  multipleStatements: true
};

const TEST_DATABASE = process.env.DB_NAME;

const bootstrapConnection = mysql.createConnection(DB_CONFIG);

const schemaSql = `
  CREATE DATABASE IF NOT EXISTS \`${TEST_DATABASE}\`;
  USE \`${TEST_DATABASE}\`;

  CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    is_admin TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    text_content TEXT,
    photo_url VARCHAR(500),
    link_url VARCHAR(2000),
    link_title VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_posts_created_at (created_at),
    INDEX idx_posts_user_id (user_id)
  );

  CREATE TABLE IF NOT EXISTS post_likes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    post_id INT NOT NULL,
    user_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_post_like (post_id, user_id),
    CONSTRAINT fk_likes_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`;

let db;
let app;
let pool;
let dbAvailable = false;
let dbUnavailableReason = '';

const skipIfDatabaseUnavailable = (t) => {
  if (!dbAvailable) {
    t.skip(`MySQL integration database unavailable: ${dbUnavailableReason}`);
    return true;
  }

  return false;
};

const resetTables = async () => {
  await db.query('DELETE FROM post_likes');
  await db.query('DELETE FROM posts');
  await db.query('DELETE FROM users');
};

test.before(async () => {
  try {
    const bootstrap = await bootstrapConnection;
    await bootstrap.query(schemaSql);
    await bootstrap.end();

    db = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: TEST_DATABASE
    });

    ({ app, pool } = require('./server'));
    await resetTables();
    dbAvailable = true;
  } catch (error) {
    dbUnavailableReason = error.message;
  }
});

test.after(async () => {
  if (pool) {
    await pool.end();
  }

  if (db) {
    await db.end();
  }
});

test.beforeEach(async () => {
  if (!dbAvailable) {
    return;
  }

  await resetTables();
});

test('register, inspect session, logout, and reject stale session', async (t) => {
  if (skipIfDatabaseUnavailable(t)) {
    return;
  }

  const agent = request.agent(app);

  const registerResponse = await agent
    .post('/api/auth/register')
    .send({ email: 'tester@example.com', password: 'password123' });

  assert.equal(registerResponse.status, 201);
  assert.equal(registerResponse.body.success, true);
  assert.equal(registerResponse.body.data.user.email, 'tester@example.com');
  assert.ok(registerResponse.headers['set-cookie']);

  const sessionResponse = await agent.get('/api/auth/me');
  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionResponse.body.data.user.email, 'tester@example.com');

  const logoutResponse = await agent.post('/api/auth/logout');
  assert.equal(logoutResponse.status, 200);
  assert.equal(logoutResponse.body.data.loggedOut, true);

  const staleSessionResponse = await agent.get('/api/auth/me');
  assert.equal(staleSessionResponse.status, 401);
  assert.equal(staleSessionResponse.body.errorCode, 'UNAUTHORIZED');
});

test('reject duplicate registration and invalid login', async (t) => {
  if (skipIfDatabaseUnavailable(t)) {
    return;
  }

  const agent = request.agent(app);

  const firstRegister = await agent
    .post('/api/auth/register')
    .send({ email: 'duplicate@example.com', password: 'password123' });

  assert.equal(firstRegister.status, 201);

  const duplicateRegister = await request(app)
    .post('/api/auth/register')
    .send({ email: 'duplicate@example.com', password: 'password123' });

  assert.equal(duplicateRegister.status, 409);
  assert.equal(duplicateRegister.body.errorCode, 'EMAIL_ALREADY_REGISTERED');

  const invalidLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'duplicate@example.com', password: 'wrong-password' });

  assert.equal(invalidLogin.status, 401);
  assert.equal(invalidLogin.body.errorCode, 'INVALID_CREDENTIALS');
});

test('create a text post and list the feed', async (t) => {
  if (skipIfDatabaseUnavailable(t)) {
    return;
  }

  const agent = request.agent(app);

  await agent
    .post('/api/auth/register')
    .send({ email: 'poster@example.com', password: 'password123' })
    .expect(201);

  const createResponse = await agent
    .post('/api/posts')
    .field('text_content', 'Hello C-Social!');

  assert.equal(createResponse.status, 201);
  assert.equal(createResponse.body.data.post.text_content, 'Hello C-Social!');
  const postId = createResponse.body.data.post.id;

  const feedResponse = await agent.get('/api/posts');
  assert.equal(feedResponse.status, 200);
  assert.equal(feedResponse.body.data.posts.length, 1);
  assert.equal(feedResponse.body.data.posts[0].id, postId);
});

test('like and unlike a post', async (t) => {
  if (skipIfDatabaseUnavailable(t)) {
    return;
  }

  const agent = request.agent(app);

  await agent
    .post('/api/auth/register')
    .send({ email: 'liker@example.com', password: 'password123' })
    .expect(201);

  const createResponse = await agent
    .post('/api/posts')
    .field('text_content', 'Like me!')
    .expect(201);

  const postId = createResponse.body.data.post.id;

  const likeResponse = await agent.post(`/api/posts/${postId}/like`);
  assert.equal(likeResponse.status, 200);
  assert.equal(likeResponse.body.data.liked, true);
  assert.equal(likeResponse.body.data.like_count, 1);

  const unlikeResponse = await agent.post(`/api/posts/${postId}/like`);
  assert.equal(unlikeResponse.status, 200);
  assert.equal(unlikeResponse.body.data.liked, false);
  assert.equal(unlikeResponse.body.data.like_count, 0);
});

test('delete own post', async (t) => {
  if (skipIfDatabaseUnavailable(t)) {
    return;
  }

  const agent = request.agent(app);

  await agent
    .post('/api/auth/register')
    .send({ email: 'deleter@example.com', password: 'password123' })
    .expect(201);

  const createResponse = await agent
    .post('/api/posts')
    .field('text_content', 'Delete me')
    .expect(201);

  const postId = createResponse.body.data.post.id;

  const deleteResponse = await agent.delete(`/api/posts/${postId}`);
  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteResponse.body.data.id, postId);

  const feedResponse = await agent.get('/api/posts');
  assert.equal(feedResponse.body.data.posts.length, 0);
});

test('prevent unauthenticated post access', async (t) => {
  if (skipIfDatabaseUnavailable(t)) {
    return;
  }

  const response = await request(app).get('/api/posts');
  assert.equal(response.status, 401);
  assert.equal(response.body.errorCode, 'UNAUTHORIZED');
});

test('prevent cross-user post deletion', async (t) => {
  if (skipIfDatabaseUnavailable(t)) {
    return;
  }

  const owner = request.agent(app);
  const intruder = request.agent(app);

  await owner
    .post('/api/auth/register')
    .send({ email: 'owner@example.com', password: 'password123' })
    .expect(201);

  await intruder
    .post('/api/auth/register')
    .send({ email: 'intruder@example.com', password: 'password123' })
    .expect(201);

  const createResponse = await owner
    .post('/api/posts')
    .field('text_content', 'My post')
    .expect(201);

  const postId = createResponse.body.data.post.id;

  const deleteResponse = await intruder.delete(`/api/posts/${postId}`);
  assert.equal(deleteResponse.status, 403);
  assert.equal(deleteResponse.body.errorCode, 'FORBIDDEN');
});

test('reject empty post creation', async (t) => {
  if (skipIfDatabaseUnavailable(t)) {
    return;
  }

  const agent = request.agent(app);

  await agent
    .post('/api/auth/register')
    .send({ email: 'empty@example.com', password: 'password123' })
    .expect(201);

  const response = await agent.post('/api/posts').send({});
  assert.equal(response.status, 400);
  assert.equal(response.body.errorCode, 'EMPTY_POST');
});

test('admin user can list all users via GET /api/admin/users', async (t) => {
  if (skipIfDatabaseUnavailable(t)) {
    return;
  }

  const adminAgent = request.agent(app);

  await adminAgent
    .post('/api/auth/register')
    .send({ email: 'admin@example.com', password: 'password123' })
    .expect(201);

  // Promote user to admin directly in the DB
  await db.query('UPDATE users SET is_admin = 1 WHERE email = ?', ['admin@example.com']);

  // Register a second non-admin user so the list has 2 entries
  await request(app)
    .post('/api/auth/register')
    .send({ email: 'regular@example.com', password: 'password123' })
    .expect(201);

  const response = await adminAgent.get('/api/admin/users');
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.users.length, 2);

  const adminUser = response.body.data.users.find(u => u.email === 'admin@example.com');
  assert.ok(adminUser);
  assert.equal(adminUser.is_admin, 1);
  // Ensure password hash is never returned
  assert.equal(adminUser.hashed_password, undefined);
});

test('regular user is denied access to GET /api/admin/users', async (t) => {
  if (skipIfDatabaseUnavailable(t)) {
    return;
  }

  const agent = request.agent(app);

  await agent
    .post('/api/auth/register')
    .send({ email: 'notadmin@example.com', password: 'password123' })
    .expect(201);

  const response = await agent.get('/api/admin/users');
  assert.equal(response.status, 403);
  assert.equal(response.body.errorCode, 'FORBIDDEN');
});

test('unauthenticated request is rejected from GET /api/admin/users', async (t) => {
  if (skipIfDatabaseUnavailable(t)) {
    return;
  }

  const response = await request(app).get('/api/admin/users');
  assert.equal(response.status, 401);
  assert.equal(response.body.errorCode, 'UNAUTHORIZED');
});