const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_USER = process.env.DB_USER || 'root';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'root';
process.env.DB_NAME = process.env.DB_NAME || 'fullstack_db_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.COOKIE_NAME = process.env.COOKIE_NAME || 'quicknotes_test_token';
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL DEFAULT 'Untitled Note',
    body TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_notes_user_id (user_id),
    INDEX idx_notes_user_updated_at (user_id, updated_at)
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
  await db.query('DELETE FROM notes');
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

test('create, list, fetch, update, and delete a note for the authenticated user', async (t) => {
  if (skipIfDatabaseUnavailable(t)) {
    return;
  }

  const agent = request.agent(app);

  await agent
    .post('/api/auth/register')
    .send({ email: 'notes@example.com', password: 'password123' })
    .expect(201);

  const createResponse = await agent
    .post('/api/notes')
    .send({ title: 'First Note', body: 'Hello world' });

  assert.equal(createResponse.status, 201);
  assert.equal(createResponse.body.data.note.title, 'First Note');
  const noteId = createResponse.body.data.note.id;

  const listResponse = await agent.get('/api/notes');
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.body.data.notes.length, 1);
  assert.equal(listResponse.body.data.notes[0].id, noteId);

  const fetchResponse = await agent.get(`/api/notes/${noteId}`);
  assert.equal(fetchResponse.status, 200);
  assert.equal(fetchResponse.body.data.note.body, 'Hello world');

  const updateResponse = await agent
    .put(`/api/notes/${noteId}`)
    .send({ title: 'Updated Note', body: 'Updated body' });

  assert.equal(updateResponse.status, 200);
  assert.equal(updateResponse.body.data.note.title, 'Updated Note');

  const deleteResponse = await agent.delete(`/api/notes/${noteId}`);
  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteResponse.body.data.id, noteId);

  const postDeleteList = await agent.get('/api/notes');
  assert.equal(postDeleteList.status, 200);
  assert.equal(postDeleteList.body.data.notes.length, 0);
});

test('prevent unauthenticated note access', async (t) => {
  if (skipIfDatabaseUnavailable(t)) {
    return;
  }

  const response = await request(app).get('/api/notes');

  assert.equal(response.status, 401);
  assert.equal(response.body.errorCode, 'UNAUTHORIZED');
});

test('prevent cross-user note access', async (t) => {
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
    .post('/api/notes')
    .send({ title: 'Private', body: 'Owner only' })
    .expect(201);

  const noteId = createResponse.body.data.note.id;

  const fetchResponse = await intruder.get(`/api/notes/${noteId}`);
  assert.equal(fetchResponse.status, 404);
  assert.equal(fetchResponse.body.errorCode, 'NOTE_NOT_FOUND');

  const deleteResponse = await intruder.delete(`/api/notes/${noteId}`);
  assert.equal(deleteResponse.status, 404);
  assert.equal(deleteResponse.body.errorCode, 'NOTE_NOT_FOUND');
});