const mongoose = require('mongoose');

const GITHUB_API = 'https://api.github.com';
let cachedConnection = null;

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function normalizePath(eventPath = '') {
  return eventPath
    .replace(/^\/\.netlify\/functions\/api/, '')
    .replace(/^\/api\/api/, '/api') || '/';
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
  } catch (error) {
    throw new Error('Invalid JSON request body.');
  }
}

function githubHeaders(extra = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'GitScope-Netlify',
    ...extra,
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    if (res.status === 404) throw new Error('GitHub user or resource not found.');
    if (res.status === 403) throw new Error('GitHub API rate limit reached. Add GITHUB_TOKEN in Netlify environment variables or try again later.');
    throw new Error(`GitHub API failed with status ${res.status}`);
  }
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: githubHeaders({ Accept: 'application/vnd.github.raw+json, application/vnd.github.v3.raw' }) });
  if (!res.ok) return '';
  return res.text();
}

async function getUser(username) {
  return fetchJson(`${GITHUB_API}/users/${encodeURIComponent(username)}`);
}

async function getRepos(username) {
  return fetchJson(`${GITHUB_API}/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated`);
}

async function getProfileReadme(username) {
  const safe = encodeURIComponent(username);
  const main = await fetchText(`https://raw.githubusercontent.com/${safe}/${safe}/main/README.md`);
  if (main) return main;
  return fetchText(`https://raw.githubusercontent.com/${safe}/${safe}/master/README.md`);
}

async function getBundle(username) {
  const [user, repos, readmeText] = await Promise.all([
    getUser(username),
    getRepos(username),
    getProfileReadme(username),
  ]);
  return { user, repos, readmeText };
}

async function connectDB() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not configured in Netlify environment variables.');
  }
  if (cachedConnection && mongoose.connection.readyState === 1) return cachedConnection;
  mongoose.set('strictQuery', true);
  cachedConnection = await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  return cachedConnection;
}

function models() {
  const Analysis = mongoose.models.Analysis || mongoose.model('Analysis', new mongoose.Schema({
    username: { type: String, required: true, index: true },
    name: String,
    total_score: Number,
    grade: mongoose.Schema.Types.Mixed,
    subs: mongoose.Schema.Types.Mixed,
    top_languages: mongoose.Schema.Types.Mixed,
    skills: [String],
    fit: [String],
    careerFit: mongoose.Schema.Types.Mixed,
    momentum: mongoose.Schema.Types.Mixed,
    categoryDistribution: mongoose.Schema.Types.Mixed,
    recruiter_summary: String,
  }, { timestamps: true }));

  const Dataset = mongoose.models.Dataset || mongoose.model('Dataset', new mongoose.Schema({
    name: { type: String, default: 'Untitled GitScope Dataset' },
    usernames: [String],
    rows: [mongoose.Schema.Types.Mixed],
    summary: mongoose.Schema.Types.Mixed,
  }, { timestamps: true }));

  const ValidationReport = mongoose.models.ValidationReport || mongoose.model('ValidationReport', new mongoose.Schema({
    dataset_id: String,
    title: { type: String, default: 'GitScope Validation Report' },
    metrics: mongoose.Schema.Types.Mixed,
    notes: String,
    rows: [mongoose.Schema.Types.Mixed],
  }, { timestamps: true }));

  return { Analysis, Dataset, ValidationReport };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});

  const path = normalizePath(event.path);
  const method = event.httpMethod;

  try {
    if (method === 'GET' && (path === '/' || path === '/api/health')) {
      return json(200, {
        ok: true,
        app: 'GitScope Netlify API',
        mongoConfigured: Boolean(process.env.MONGODB_URI),
        githubTokenConfigured: Boolean(process.env.GITHUB_TOKEN),
        timestamp: new Date().toISOString(),
      });
    }

    const githubBundle = path.match(/^\/api\/github\/bundle\/([^/]+)$/);
    if (method === 'GET' && githubBundle) {
      return json(200, await getBundle(decodeURIComponent(githubBundle[1])));
    }

    const githubUser = path.match(/^\/api\/github\/user\/([^/]+)$/);
    if (method === 'GET' && githubUser) {
      return json(200, await getUser(decodeURIComponent(githubUser[1])));
    }

    const githubRepos = path.match(/^\/api\/github\/repos\/([^/]+)$/);
    if (method === 'GET' && githubRepos) {
      return json(200, await getRepos(decodeURIComponent(githubRepos[1])));
    }

    const githubReadme = path.match(/^\/api\/github\/readme\/([^/]+)$/);
    if (method === 'GET' && githubReadme) {
      return json(200, { readmeText: await getProfileReadme(decodeURIComponent(githubReadme[1])) });
    }

    if (path.startsWith('/api/analysis') || path.startsWith('/api/datasets') || path.startsWith('/api/validation')) {
      await connectDB();
      const { Analysis, Dataset, ValidationReport } = models();

      if (method === 'POST' && path === '/api/analysis') {
        const doc = await Analysis.create(parseBody(event));
        return json(201, { message: 'Analysis saved', analysis: doc });
      }
      if (method === 'GET' && path === '/api/analysis') {
        return json(200, await Analysis.find().sort({ createdAt: -1 }).limit(100));
      }
      const analysisUser = path.match(/^\/api\/analysis\/([^/]+)$/);
      if (method === 'GET' && analysisUser) {
        return json(200, await Analysis.find({ username: decodeURIComponent(analysisUser[1]) }).sort({ createdAt: -1 }).limit(20));
      }

      if (method === 'POST' && path === '/api/datasets') {
        const doc = await Dataset.create(parseBody(event));
        return json(201, { message: 'Dataset saved', dataset: doc });
      }
      if (method === 'GET' && path === '/api/datasets') {
        return json(200, await Dataset.find().sort({ createdAt: -1 }).limit(100));
      }
      const datasetId = path.match(/^\/api\/datasets\/([^/]+)$/);
      if (method === 'GET' && datasetId) {
        const doc = await Dataset.findById(datasetId[1]);
        if (!doc) return json(404, { error: 'Dataset not found' });
        return json(200, doc);
      }

      if (method === 'POST' && path === '/api/validation') {
        const doc = await ValidationReport.create(parseBody(event));
        return json(201, { message: 'Validation report saved', report: doc });
      }
      if (method === 'GET' && path === '/api/validation') {
        return json(200, await ValidationReport.find().sort({ createdAt: -1 }).limit(100));
      }
    }

    return json(404, { error: 'Route not found', path });
  } catch (error) {
    console.error('[GitScope Netlify API]', error);
    return json(500, { error: error.message || 'Server error' });
  }
};
