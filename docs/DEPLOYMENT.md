# Deployment Guide

This project is split into two repositories:
1. **Backend** (`playwright-project`) → Deploys to **Render**
2. **Frontend** (`playwright-frontend`) → Deploys to **Vercel**

## Architecture

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│   Vercel (Frontend)     │         │  Render (Backend)            │
│                         │  API    │                              │
│   index.html + app.js   │ ──────► │  ui-server.js                │
│                         │  calls  │  + Playwright + Browsers     │
│                         │         │                              │
│ playwright-frontend.    │         │  playwright-backend.         │
│ vercel.app              │         │  onrender.com                │
└─────────────────────────┘         └──────────────────────────────┘
```

---

## Step 1: Deploy Backend to Render

### Option A: One-Click Deploy (Recommended)

1. Push `playwright-project` to GitHub
2. Go to [render.com/new](https://render.com/new)
3. Select "Blueprint" and connect your repo
4. Render reads `render.yaml` and deploys automatically

### Option B: Manual Deploy

1. Go to [render.com/new/web-service](https://dashboard.render.com/new/web-service)
2. Connect your GitHub repo (`playwright-project`)
3. Configure:
   - **Name**: `playwright-backend`
   - **Environment**: Docker
   - **Dockerfile Path**: `./Dockerfile`
   - **Health Check Path**: `/health`
4. Add environment variable:
   - `CORS_ORIGINS`: `*` (for testing) or your Vercel frontend URL
5. Click **Create Web Service**

### After Deploy

Copy your Render URL, e.g.:
```
https://playwright-backend.onrender.com
```

---

## Step 2: Deploy Frontend to Vercel

1. **Update API_BASE** in `playwright-frontend/public/app.js`:
   ```javascript
   const API_BASE = 'https://playwright-backend.onrender.com';
   ```

2. **Push to GitHub** and connect to Vercel, or deploy manually:
   ```bash
   cd playwright-frontend
   vercel --prod
   ```

---

## Step 3: Update CORS (Production)

After deploying the frontend, restrict CORS on Render:

1. Go to **Render Dashboard** → Your Service → **Environment**
2. Update `CORS_ORIGINS`:
   ```
   https://playwright-frontend.vercel.app
   ```
3. Click **Save Changes** (auto-redeploys)

---

## Environment Variables

### Backend (Render)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `4177` |
| `CORS_ORIGINS` | Allowed origins (comma-separated or `*`) | `*` |

### Frontend (Vercel)

Edit `API_BASE` in `public/app.js` directly.

---

## Local Development

### Run Backend Locally
```bash
cd playwright-project
npm install
npm run config:web
# Server at http://localhost:4177
```

### Run Frontend Locally
```bash
cd playwright-frontend
npm run dev
# Opens http://localhost:3000
```

For local testing, update `API_BASE` in `app.js`:
```javascript
const API_BASE = 'http://localhost:4177';
```

---

## Notes

- **Headed mode** works on Render because the Playwright Docker image includes Xvfb
- **Free tier**: Render spins down after inactivity; first request takes ~30s
- **Production**: Use Render's "Starter" plan ($7/mo) for always-on service
- **Security**: Set `CORS_ORIGINS` to your exact frontend URL in production
