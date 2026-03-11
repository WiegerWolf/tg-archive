# Telegram Archive Agent

A service that connects to Telegram servers and archives conversations, messages, and media files.

## Features

- Telegram API integration using official client library
- QR code login support
- Historical message syncing
- Real-time message monitoring
- Media file processing and storage
- Version tracking for dialog changes
- Support for all message types and media formats

## Prerequisites

- [Bun](https://bun.sh/) runtime
- MongoDB instance
- MinIO/S3-compatible storage
- Telegram API credentials

## Environment Variables

Create a `.env` file based on `.env.example`:

```env
# Telegram Configuration
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_PASSWORD=your_2fa_password
TELEGRAM_SESSION_STRING=your_session_string

# MongoDB Configuration
MONGO_URI=mongodb://db/tgArchive

# MinIO Configuration
S3_ENDPOINT_HOST=minio
S3_ENDPOINT_PORT=9000
S3_ACCESS_KEY=your_minio_access_key
S3_SECRET_KEY=your_minio_secret_key
S3_BUCKET_NAME=tg-archive
S3_REGION=us-east-1

# Import Configuration
DROP_MONGO_COLLECTION_BEFORE_IMPORT=false
```

## Installation

```bash
# Install dependencies
bun install

# Start the agent
bun run start
```

## Docker Deployment

```bash
# Build the image
docker build -t telegram-archive-agent .

# Run the container
docker run -d \
  --env-file .env \
  telegram-archive-agent
```

## Usage

The agent will:
1. Connect to Telegram using provided credentials
2. Sync historical messages for all dialogs
3. Monitor for new messages in real-time
4. Download and store media files
5. Track dialog changes and versions

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run start
```
