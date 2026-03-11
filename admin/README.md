# Telegram Archive Admin Interface

A web-based admin interface for viewing and managing archived Telegram conversations, built with Bun, Express, and a React + Vite frontend using Tailwind CSS and shadcn-style UI primitives.

## Features

### Dialog Management
- View all archived dialogs (users, groups, channels, bots)
- Filter between different conversation types
- Track dialog changes and versions
- View detailed dialog information

### Message Viewing
- Chronological message history
- Message threading support
- Rich media preview
- Pagination support

### Media Support
- Image and video preview
- Document download
- Audio player for voice messages
- Animated sticker playback
- Location message mapping
- Service message visualization

### UI Features
- Responsive design with Tailwind CSS
- Real-time message linking
- Smooth scroll to referenced messages
- Message highlighting
- Media galleries

## Prerequisites

- [Bun](https://bun.sh/) runtime
- MongoDB instance
- MinIO/S3-compatible storage
- Docker (optional)

## Environment Variables

Create a `.env` file based on `.env.example`:

```env
# MongoDB Configuration
MONGO_URI=mongodb://db/tgArchive

# MinIO Configuration
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET_NAME=tg-archive
```

## Installation

### Local Development

1. Clone the repository

2. Install dependencies:
```bash
bun install
```

3. Build the modern frontend:
```bash
bun run build:web
```

4. Start the development server:
```bash
bun run index.ts
```

### Docker Deployment

1. Build the Docker image:
```bash
docker build -t telegram-archive-admin .
```

2. Run the container:
```bash
docker run -p 3000:3000 --env-file .env telegram-archive-admin
```

## Project Structure

```
admin/
├── index.ts              # Main application entry point
├── tailwind.config.cjs   # Tailwind config for web build
├── components.json       # shadcn/ui CLI configuration
├── web/                 # React + Vite app
│   ├── src/             # Frontend source
│   └── dist/            # Built frontend assets
├── shared/              # Shared routes and API schemas
├── public/             # Static assets
└── package.json        # Dependencies and scripts
```

## Development

### Running Locally

1. Start MongoDB and MinIO:
```bash
docker compose up -d db minio
```

2. Start the development server:
```bash
bun run index.ts
```

### shadcn/ui Components

Add new shadcn components with:

```bash
bun run shadcn:add <component-name>
```

### Building for Production

```bash
docker compose build admin
```

## API Endpoints

- `GET /api/dialogs` - Dialog list for the React app
- `GET /api/agent/status` - Agent status for the React app
- `POST /api/agent/auth/password` - Submit Telegram 2FA password
- `GET /` - Main dialog list
- `GET /dialog/:id` - Dialog details
- `GET /dialog/:id/messages` - Message list for a dialog
- `GET /message/:id` - Individual message view
- `GET /media/:key` - Media file access

## Browser Support

The interface is tested and supported on:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request
