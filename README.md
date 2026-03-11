# Telegram Archive System

A comprehensive system for archiving and managing Telegram conversations, consisting of a Telegram agent for data collection and a web-based admin interface for viewing and managing the archived data.

## System Components

### Agent
- Connects to Telegram using official APIs
- Archives messages, media, and conversation data
- Supports both historical sync and real-time updates
- Stores data in MongoDB and media files in MinIO
- Built with Bun runtime and Telegram API

### Admin Interface
- Web-based dashboard for viewing archived data
- Filters for users, groups, channels, and bots
- Detailed conversation and message views
- Media preview and download capabilities
- Built with Bun, Express, EJS, and Tailwind CSS

## Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- Telegram API credentials from [my.telegram.org](https://my.telegram.org)
- Environment variables configuration

## Quick Start

1. Clone the repository

2. Create a `.env` file in the root directory with the required credentials and storage settings:
```env
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_PASSWORD=your_2fa_password_if_enabled
TELEGRAM_SESSION_STRING=your_session_string
ADMIN_PASSWORD=choose_a_strong_password
ADMIN_COOKIE_SECRET=choose_a_long_random_secret
MINIO_ROOT_USER=choose_a_minio_root_user
MINIO_ROOT_PASSWORD=choose_a_minio_root_password
```

`ADMIN_PASSWORD` enables the admin login screen. `ADMIN_COOKIE_SECRET` signs the login cookie and should be a long random string. `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` are required by the bundled MinIO service.

For local HTTP-only development, set `ADMIN_COOKIE_SECURE=false`. For any real deployment behind HTTPS, keep it `true`.

3. Create the local MinIO data directory:
```bash
mkdir -p ./data/minio-data
```

4. Start the system using Docker Compose:
```bash
docker compose up -d
```

By default, the MinIO API and console bind to `127.0.0.1` only. If you need remote access, set `MINIO_BIND_HOST` explicitly.

This will start:
- Admin interface on http://localhost:3000
- Agent service for data collection
- MongoDB database
- MinIO object storage

## Features

### Message Types Support
- Text messages with formatting
- Photos and videos
- Documents and files
- Stickers and animations
- Voice messages
- Location sharing
- Service messages (calls, pins, etc.)

### Media Handling
- Automatic media download and storage
- Thumbnail generation
- Content-type detection
- Deduplication using content hashing
- Streaming support for audio/video

### Data Management
- Version tracking for dialog changes
- Historical message syncing
- Real-time updates
- Message threading support
- Media file management

## Development

Each component can be developed independently. See the README.md files in their respective directories:
- [Agent Documentation](./agent/README.md)
- [Admin Interface Documentation](./admin/README.md)
- [Operations Guide](./docs/OPERATIONS.md)

### Full hot reload dev stack

Use the dev override compose file to run backend + frontend + agent in watch mode:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db minio admin agent admin-web
```

Use:

- `http://localhost:5173` for frontend development (Vite HMR)
- `http://localhost:3000` for admin backend/API/media

Notes:

- UI changes in `admin/web/src` reload instantly.
- Backend changes in `admin/index.ts` restart automatically via `bun --watch`.
- Agent changes in `agent/*.ts` restart automatically via `bun --watch`.
- In dev mode, agent runs with `IMPORT_BEFORE_LIVE_SYNC=false` to keep restarts fast.

### Isolated local development

To keep local development separate from any deployed environment or shared storage, use the local-only env file and helper script:

```bash
cp .env.local.example .env.local
./scripts/dev-local.sh up
```

This local mode:

- uses `COMPOSE_PROJECT_NAME=tg-archive-local`, so MongoDB uses separate local Docker volumes
- stores MinIO data under `./.local-dev/minio-data` instead of your shared or deployed storage path
- uses a separate MinIO bucket name (`tg-archive-local`)
- starts `db`, `minio`, `admin`, and `admin-web` only by default
- leaves the Telegram agent off unless you explicitly opt in

Useful commands:

```bash
./scripts/dev-local.sh up
./scripts/dev-local.sh up --with-agent
./scripts/dev-local.sh ps
./scripts/dev-local.sh down
```

Default local URLs:

- `http://localhost:5173` - Vite frontend
- `http://localhost:3000` - admin backend
- `http://localhost:19000` - local MinIO API
- `http://localhost:19001` - local MinIO console

## Moving to another machine

Use these scripts to copy MongoDB data between the Docker volume and a backup directory:

- Export current MongoDB volume to a backup directory:
  - `./scripts/mongo-sync-to-nas.sh`
- Import MongoDB data from a backup directory into a local Docker volume:
  - `./scripts/mongo-sync-from-nas.sh`

Defaults:
- Backup path: `./backups/mongodb-data`
- Docker volume: `tg-archive_mongodb_data`

Optional overrides:
- `MONGO_BACKUP_DIR=/custom/path ./scripts/mongo-sync-to-nas.sh`
- `MONGO_VOLUME_NAME=custom_volume ./scripts/mongo-sync-from-nas.sh`

## Architecture

The system uses a microservices architecture:
- Agent service for data collection
- Admin service for data visualization
- MongoDB for structured data storage
- MinIO for media file storage
- Docker for containerization and orchestration
