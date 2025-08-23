# Qimchi React Frontend

This README explains how to set up and run the frontend locally and with Docker.

## Prerequisites
- Node.js 24+ and npm
- (Optional) Docker and docker-compose for containerized runs

## Local development
1. Install dependencies

```pwsh
cd frontend
npm install
```

2. Start the dev server

```pwsh
npm run dev
```

The app expects the backend API to be reachable at http://0.0.0.0:8000 (production backend URL). You can change this in `src/config.ts` if needed.

## Production build

```pwsh
cd frontend
npm run build
```

Generated production assets are in `dist/`.

## Docker

The repository includes a frontend `Dockerfile` and `docker-compose.yml` to build and serve the frontend as a static site.

### Running both frontend and backend with Docker Compose

See the top-level `docker-compose.yml` which composes both the backend and frontend services.

## Notes
- The frontend centralises the backend base URL in `src/config.ts`. By default it is set to `http://0.0.0.0:8000` and the WebSocket URL to `ws://0.0.0.0:8000`.
