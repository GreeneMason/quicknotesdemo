# QuickNotes Roadmap

## Overview
QuickNotes is a minimalist note-taking app where authenticated users can create, view, edit, and delete notes.

## Product Goal
Ship a clean, fast notes experience with:
- Login and session-based authentication
- Real-time style auto-save while editing
- Full CRUD for user-owned notes

## Current Status
- [x] Frontend MVP flow is implemented: auth, dashboard, editor, auto-save, empty states, and responsive layout.
- [x] Backend MVP API is implemented: auth, protected notes CRUD, validation, structured responses, and logging.
- [x] Backend integration test harness exists for auth and notes CRUD.
- [ ] Integration tests still need a real local MySQL instance on this machine to run end to end.
- [ ] AWS deployment still needs live environment verification.

## Tech Stack
- Frontend: React (Vite)
- Backend: Node.js (Express)
- Database: MySQL
- Infrastructure: AWS (EC2 + Nginx reverse proxy)

## Core User Flow
1. User registers or logs in.
2. User lands on the notes dashboard.
3. User selects or creates a note.
4. Edits auto-save without a Save button.
5. User can delete notes or log out.

## Frontend Roadmap

### Phase 1: Auth UI
- [x] Build login form (email + password).
- [x] Build register form (email + password).
- [x] Handle auth errors and loading states.

### Phase 2: Notes Dashboard Layout
- [x] Sidebar for note title list.
- [x] Main editor panel for selected note.
- [x] Add New Note, Delete Note, and Logout buttons.

### Phase 3: Editor + Auto-Save
- [x] Editable title + body fields.
- [x] Debounced auto-save (for example 500-1000ms delay).
- [x] Save state indicators (Saving, Saved, Error).

### Phase 4: UX Polish
- [x] Empty-state views (no notes selected / no notes yet).
- [x] Keyboard shortcuts (optional): new note, delete note.
- [x] Basic responsive layout for mobile/tablet.

## Backend Roadmap

### Phase 1: Auth API
- [x] `POST /auth/register` to create users.
- [x] `POST /auth/login` to authenticate users.
- [x] `POST /auth/logout` to end session.
- [x] `GET /auth/me` to return current user session.

### Phase 2: Notes API (Protected)
- [x] `GET /notes` list current user's notes.
- [x] `GET /notes/:id` return one note owned by user.
- [x] `POST /notes` create note.
- [x] `PUT /notes/:id` update note.
- [x] `DELETE /notes/:id` delete note.

### Phase 3: Middleware + Validation
- [x] Auth middleware to protect `/notes` routes.
- [x] Request validation for IDs, title/body lengths, and required fields.
- [x] Ownership checks to prevent cross-user access.

### Phase 4: Reliability
- [x] Centralized error handler.
- [x] Structured API response format.
- [x] Logging for auth failures and API errors.

### Phase 5: Automated Verification
- [x] Add backend integration tests for auth flows and notes CRUD.
- [ ] Run the integration suite successfully against a local MySQL test database.

## Database Roadmap

### Schema
- [x] `users` table:
  - `id` (PK)
  - `email` (unique)
  - `hashed_password`
  - `created_at`
- [x] `notes` table:
  - `id` (PK)
  - `user_id` (FK -> users.id)
  - `title`
  - `body`
  - `updated_at`
  - `created_at`

### Indexes
- [x] Unique index on `users.email`.
- [x] Index on `notes.user_id`.
- [x] Composite index on `(user_id, updated_at)` for sorted note lists.

## Security Checklist
- [x] Hash passwords with bcrypt.
- [x] Store sessions securely (HTTP-only cookie).
- [x] Enable CORS with credentials for frontend origin.
- [x] Add rate limiting on auth endpoints.
- [x] Use parameterized SQL queries.

## AWS Deployment Roadmap

### Phase 1: EC2 Runtime
- Provision EC2 instance.
- Install Node.js, MySQL/MariaDB, and Nginx.
- Configure Security Group for ports 22, 80, and 443.

### Phase 2: App Deployment
- Deploy backend as a process (PM2/systemd).
- Build frontend and serve static files via Nginx.
- Configure Nginx reverse proxy for `/api` -> backend.

### Phase 3: Production Hardening
- Add HTTPS (Let's Encrypt).
- Enable backups for MySQL.
- Add monitoring/logging and restart policies.

### Phase 4: Launch Readiness
- Add a post-deploy healthcheck script for nginx, backend, and MySQL.
- Verify HTTPS redirect, API reachability, and disk/memory usage.
- Document rollback and restart steps for production incidents.
- Establish a simple operational checklist for launches.

## Suggested Milestones
- [x] Milestone 1: Auth complete (register/login/logout/me).
- [x] Milestone 2: Notes CRUD complete with ownership checks.
- [x] Milestone 3: Frontend dashboard + editor + auto-save complete.
- [x] Milestone 4: Backend integration test harness added for auth and notes CRUD.
- [ ] Milestone 5: Local MySQL-backed integration tests passing.
- [ ] Milestone 6: EC2 deployment live with Nginx + domain/HTTPS.

## Definition of Done (MVP)
- [x] User can register, login, and logout.
- [x] User can create, edit (auto-save), list, and delete notes.
- [x] Notes are private per user.
- [ ] App is reachable on AWS EC2 through Nginx.
- [x] Basic error handling and validation are in place.
