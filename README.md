# Full Stack Demo

React (Vite) + Node.js (Express) + MySQL, organized for AWS deployment.

## Repository Layout

```text
.
|-- apps/
|   |-- backend/            # Node.js API
|   |   |-- server.js
|   |   |-- package.json
|   |   `-- .env.example
|   `-- frontend/           # React + Vite client
|       |-- src/
|       |-- index.html
|       |-- vite.config.js
|       `-- package.json
|-- database/
|   `-- mysql/
|       `-- schema.sql
|-- infrastructure/
|   `-- aws/
|       |-- ec2-setup.sh
|       `-- nginx.conf
`-- package.json            # Root helper scripts
```

## Local Development

### 1. MySQL

Run `database/mysql/schema.sql` in MySQL.

### 2. Backend

```bash
cd apps/backend
npm install
npm run dev
```

Backend defaults:
- Host: `0.0.0.0`
- Port: `5000`
- DB host: `localhost`
- DB user/password: `root` / `root`

You can override with environment variables from `apps/backend/.env.example`.

### 3. Frontend (Vite)

```bash
cd apps/frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173` and proxies `/api` to `http://localhost:5000`.

## Root Scripts

From repo root:

```bash
npm run backend:dev
npm run backend:test
npm run frontend:dev
npm run frontend:build
```

## Backend Integration Tests

The backend test suite lives in `apps/backend/server.test.js` and uses Node's built-in test runner plus `supertest`.

### Prerequisites

- A local MySQL server must be running and reachable on `localhost:3306`.
- The configured database user must be able to create a test database.
- By default, the suite uses:
	- `DB_HOST=localhost`
	- `DB_USER=root`
	- `DB_PASSWORD=root`
	- `DB_NAME=fullstack_db_test`

### Run The Suite

From the backend directory:

```bash
cd apps/backend
npm test
```

From the repo root:

```bash
npm run backend:test
```

### What The Tests Cover

- Register, session lookup, logout, and stale-session rejection
- Duplicate registration and invalid-login handling
- Authenticated note create, list, fetch, update, and delete flows
- Unauthenticated access rejection
- Cross-user note access rejection

### Current Behavior Without MySQL

If MySQL is not running locally, the suite skips the integration cases and reports that the MySQL integration database is unavailable. That keeps CI or local runs readable while still making the missing dependency explicit.

## AWS Notes

- AWS files live in `infrastructure/aws/`.
- See [ROADMAP.md](ROADMAP.md) for full deployment phases.

### AWS Deployment Phase 1 — Provision & Runtime

```bash
# 1. From your local machine: create EC2 instance + security group
export KEY_PAIR_NAME=quicknotesKey
bash infrastructure/aws/provision.sh

# 2. SSH into the instance
ssh -i ~/.ssh/quicknotesKey.pem ec2-user@<PUBLIC_IP>

# 3. On the instance: install Node.js, nginx, MariaDB
export DB_PASSWORD=your_strong_password
bash infrastructure/aws/ec2-setup.sh
```

### AWS Deployment Phase 2 — App Deployment

```bash
# 1. On the instance: clone the repo
git clone https://github.com/GreeneMason/fullStackDemo.git /home/ec2-user/app
cd /home/ec2-user/app

# 2. Create the backend .env
cp apps/backend/.env.example apps/backend/.env
# Edit apps/backend/.env — set DB_PASSWORD, JWT_SECRET, FRONTEND_ORIGIN

# 3. Deploy (idempotent — run again for every update)
bash infrastructure/aws/deploy.sh
```

`deploy.sh` does the following in order:
1. `git pull` latest code
2. `npm ci --omit=dev` for the backend
3. Starts/reloads the backend via **PM2** (`ecosystem.config.js`)
4. Applies the database schema (idempotent)
5. Builds the frontend and copies `dist/` to `/usr/share/nginx/html`

Useful PM2 commands:
```bash
pm2 status                    # process list
pm2 logs quicknotes-api       # tail logs
pm2 reload quicknotes-api     # zero-downtime restart
```

### AWS Deployment Phase 3 — Production Hardening

```bash
# 1. Enable HTTPS with Let's Encrypt
sudo bash infrastructure/aws/ssl-setup.sh yourdomain.com admin@yourdomain.com

# 2. Install the backup timer
sudo cp infrastructure/aws/quicknotes-backup.service /etc/systemd/system/
sudo cp infrastructure/aws/quicknotes-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now quicknotes-backup.timer

# 3. Run a manual backup test
sudo bash infrastructure/aws/backup.sh
```

Phase 3 covers:
1. HTTPS via Let's Encrypt and nginx redirection
2. Daily MySQL backups with retention
3. PM2 restart policies + systemd startup on reboot
4. Log inspection with `pm2 logs quicknotes-api`

### AWS Deployment Phase 4 — Launch Readiness

```bash
# Run after any deploy or restart
bash infrastructure/aws/healthcheck.sh
```

Phase 4 covers:
1. Frontend root and `/api/auth/me` reachability
2. nginx + PM2 process verification
3. MySQL ping checks from backend credentials
4. Disk and memory usage warnings
5. A simple pre-launch operational checklist

## API Endpoints

- `GET  /api/auth/me`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET  /api/notes`
- `POST /api/notes`
- `GET  /api/notes/:id`
- `PUT  /api/notes/:id`
- `DELETE /api/notes/:id`
