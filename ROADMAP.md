# QuickNotes Roadmap

## Overview
QuickNotes is a minimalist note-taking app where authenticated users can create, view, edit, and delete notes.

## Product Goal
Ship a clean, fast notes experience with:
- Login and session-based authentication
- Real-time style auto-save while editing
- Full CRUD for user-owned notes

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
- Build login form (email + password).
- Build register form (email + password).
- Handle auth errors and loading states.

### Phase 2: Notes Dashboard Layout
- Sidebar for note title list.
- Main editor panel for selected note.
- Add New Note, Delete Note, and Logout buttons.

### Phase 3: Editor + Auto-Save
- Editable title + body fields.
- Debounced auto-save (for example 500-1000ms delay).
- Save state indicators (Saving, Saved, Error).

### Phase 4: UX Polish
- Empty-state views (no notes selected / no notes yet).
- Keyboard shortcuts (optional): new note, delete note.
- Basic responsive layout for mobile/tablet.

## Backend Roadmap

### Phase 1: Auth API
- `POST /auth/register` to create users.
- `POST /auth/login` to authenticate users.
- `POST /auth/logout` to end session.
- `GET /auth/me` to return current user session.

### Phase 2: Notes API (Protected)
- `GET /notes` list current user's notes.
- `GET /notes/:id` return one note owned by user.
- `POST /notes` create note.
- `PUT /notes/:id` update note.
- `DELETE /notes/:id` delete note.

### Phase 3: Middleware + Validation
- Auth middleware to protect `/notes` routes.
- Request validation for IDs, title/body lengths, and required fields.
- Ownership checks to prevent cross-user access.

### Phase 4: Reliability
- Centralized error handler.
- Structured API response format.
- Logging for auth failures and API errors.

## Database Roadmap

### Schema
- `users` table:
  - `id` (PK)
  - `email` (unique)
  - `hashed_password`
  - `created_at`
- `notes` table:
  - `id` (PK)
  - `user_id` (FK -> users.id)
  - `title`
  - `body`
  - `updated_at`
  - `created_at`

### Indexes
- Unique index on `users.email`.
- Index on `notes.user_id`.
- Optional composite index on `(user_id, updated_at)` for sorted note lists.

## Security Checklist
- Hash passwords with bcrypt.
- Store sessions securely (HTTP-only cookie).
- Enable CORS with credentials for frontend origin.
- Add rate limiting on auth endpoints.
- Use parameterized SQL queries.

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
- Milestone 1: Auth complete (register/login/logout/me).
- Milestone 2: Notes CRUD complete with ownership checks.
- Milestone 3: Frontend dashboard + editor + auto-save complete.
- Milestone 4: EC2 deployment live with Nginx + domain/HTTPS.

## Definition of Done (MVP)
- User can register, login, and logout.
- User can create, edit (auto-save), list, and delete notes.
- Notes are private per user.
- App is reachable on AWS EC2 through Nginx.
- Basic error handling and validation are in place.
