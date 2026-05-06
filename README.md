# GitScope

GitScope is a GitHub portfolio analyzer for developers and recruiters. It evaluates public GitHub profiles, repository quality, documentation signals, activity patterns, career-fit indicators, and research validation metrics using GitHub data.

This version is ready for **Netlify deployment** with:

- Static frontend hosted by Netlify
- Backend API powered by Netlify Functions
- MongoDB Atlas for saved analyses and datasets
- One public URL for users, such as `gitscope.musfiqsama.me`

## Features

- Analyze any public GitHub username
- Portfolio score and letter grade
- Score breakdown across profile, repositories, documentation, activity, community signals, and stack clarity
- Recruiter-style profile summary
- Repository health and category analysis
- Portfolio radar chart and repository distribution chart
- Dataset mode for analyzing multiple GitHub usernames
- Human reviewer score input
- Validation analytics including correlation and error metrics
- CSV, JSON, and validation report export
- Save single analyses and datasets to MongoDB Atlas
- Direct mode fallback if the Netlify API is unavailable

## Project Structure

```text
gitscope/
  frontend/
    index.html
    app.js
    styles.css
    assets/
      gitscope-icon.png

  netlify/
    functions/
      api.js

  docs/
  research/
  package.json
  netlify.toml
  .env.example
  README.md
```

## How It Works

GitScope can run in two modes:

### Backend Mode

The frontend calls Netlify Functions:

```text
/.netlify/functions/api
```

Netlify Functions then:

- fetch GitHub profile and repository data
- use optional GitHub token for better rate limits
- save analyses and datasets to MongoDB Atlas

### Direct Mode

The frontend calls GitHub public APIs directly from the browser. This is useful if the backend/API is unavailable, but saving to MongoDB will not work in Direct Mode.

## Environment Variables

In Netlify, add these environment variables:

```env
MONGODB_URI=mongodb+srv://YOUR_USERNAME:YOUR_PASSWORD@gitscope-cluster.xxxxx.mongodb.net/gitscope?retryWrites=true&w=majority
GITHUB_TOKEN=your_github_token_optional
```

`MONGODB_URI` is required for saving analyses and datasets.

`GITHUB_TOKEN` is optional, but recommended to reduce GitHub API rate-limit issues.

Never commit `.env` or real secrets to GitHub.

## Netlify Deployment

### 1. Push to GitHub

Push this project to a GitHub repository.

Do not push `.env`.

### 2. Import in Netlify

Go to Netlify:

```text
Add new project → Import an existing project → GitHub → select your GitScope repo
```

### 3. Build Settings

Netlify should read `netlify.toml` automatically.

Expected settings:

```text
Build command: npm run build
Publish directory: frontend
Functions directory: netlify/functions
```

### 4. Add Environment Variables

In Netlify project settings:

```text
Site configuration → Environment variables
```

Add:

```text
MONGODB_URI
GITHUB_TOKEN
```

### 5. Deploy

Deploy the site. Netlify will create a default URL like:

```text
https://your-site-name.netlify.app
```

Open it and test:

```text
Data Mode: Backend
Backend URL: /.netlify/functions/api
```

Then analyze a username and try saving a dataset.

## Custom Domain Setup

Recommended public URL:

```text
gitscope.musfiqsama.me
```

In Netlify:

```text
Project → Domain management → Add custom domain
```

Add:

```text
gitscope.musfiqsama.me
```

If your domain uses Netlify DNS, create a subdomain record for `gitscope` pointing to the Netlify site.

If your domain uses Name.com DNS, add:

```text
Type: CNAME
Host: gitscope
Value: your-netlify-site-name.netlify.app
```

After DNS propagation, enable HTTPS in Netlify.

## MongoDB Collections

When data is saved, MongoDB will create collections such as:

```text
analyses
datasets
validationreports
```

Use MongoDB Atlas Data Explorer to confirm saved records.

## API Endpoints

Netlify Function base:

```text
/.netlify/functions/api
```

Available routes:

```text
GET  /api/health
GET  /api/github/bundle/:username
GET  /api/github/user/:username
GET  /api/github/repos/:username
GET  /api/github/readme/:username
POST /api/analysis
GET  /api/analysis
GET  /api/analysis/:username
POST /api/datasets
GET  /api/datasets
GET  /api/datasets/:id
POST /api/validation
GET  /api/validation
```

The included `netlify.toml` also supports `/api/*` redirects to the same function.

## Local Development with Netlify CLI

Install dependencies:

```bash
npm install
```

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

On Windows CMD:

```cmd
copy .env.example .env
```

Add your MongoDB URI to `.env`, then run:

```bash
npm run dev
```

Netlify Dev will serve frontend and functions together.

## Security Notes

- Do not expose MongoDB URI in frontend code.
- Do not commit `.env`.
- Keep GitHub token in Netlify environment variables only.
- Use MongoDB Atlas Network Access settings carefully.
- For production, restrict database access as much as practical.

## Author

Made by Musfiqur Rahman Sama
