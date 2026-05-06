
// GitScope — Netlify deployment build
// Frontend + Netlify Functions + MongoDB Atlas.

const { useEffect, useMemo, useRef, useState } = React;

const fmt = new Intl.NumberFormat('en', { notation: 'compact' });

// ─── API CONFIG ──────────────────────────────────────────────────────────────
// direct  = browser talks directly to GitHub public API
// backend = browser talks to Netlify Functions, which can save research data to MongoDB
const DEFAULT_API_BASE = '/.netlify/functions/api';

async function apiRequest(baseUrl, path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `API request failed: ${path}`);
  return data;
}


// ─── SCORING FRAMEWORK ────────────────────────────────────────────────────────
//
// GitScope uses a transparent, rule-based scoring model across 6 dimensions.
// Total = sum of all dimensions, capped at 100.
//
// Dimension          Max    Rationale
// ─────────────────────────────────────
// Profile            20     First impression: bio, avatar, links, README
// Repo Quality       25     Core work quality: descriptions, originality
// Documentation      20     Knowledge transfer: topics, README, descriptions
// Activity           15     Recency signals: recent updates, repo volume
// Community Signals  10     Peer validation: stars, forks
// Stack Clarity      10     Technical identity: language focus vs scatter
// ─────────────────────────────────────
// TOTAL             100

const SCORE_META = {
  profileScore:  { label: 'Profile',           max: 20 },
  repoQuality:   { label: 'Repo Quality',       max: 25 },
  docsScore:     { label: 'Documentation',      max: 20 },
  activityScore: { label: 'Activity',           max: 15 },
  signalsScore:  { label: 'Community Signals',  max: 10 },
  stackScore:    { label: 'Stack Clarity',      max: 10 },
};

// Scoring methodology descriptions shown in the Methodology panel
const METHODOLOGY = [
  {
    key: 'profileScore',
    label: 'Profile Completeness (max 20)',
    weight: '20%',
    description: 'Measures how well the developer presents themselves. Includes avatar presence (+2), written bio (+5), location (+2), external links or company (+4), and a pinned profile README (+7). A complete profile reduces recruiter friction and signals professional intent.',
  },
  {
    key: 'repoQuality',
    label: 'Repository Quality (max 25)',
    weight: '25%',
    description: 'Assesses the quality of public work. Repositories with descriptions score higher (up to +10 proportionally), original (non-forked) repos are rewarded (+10 proportionally), and at least one starred repo adds a peer-validation bonus (+5). Forks without modification are considered passive work.',
  },
  {
    key: 'docsScore',
    label: 'Documentation Quality (max 20)',
    weight: '20%',
    description: 'Rewards knowledge-transfer signals. Profile README presence (+8), average topics per repo (+5 if >1 per repo, else +2), and proportion of repos with descriptions (+7 proportional). Good documentation indicates communication skills, not just coding ability.',
  },
  {
    key: 'activityScore',
    label: 'Activity & Momentum (max 15)',
    weight: '15%',
    description: 'Measures recency and volume of visible public work. Repos updated within the last 120 days are counted as "recently active" (up to +10 proportionally). Having 3 or more public repos adds a baseline portfolio depth bonus (+5). This dimension is limited to public activity only.',
  },
  {
    key: 'signalsScore',
    label: 'Community Signals (max 10)',
    weight: '10%',
    description: 'Peer validation via stars and forks. Stars >10 score +6 (vs >0 = +3); forks >5 score +4 (vs >0 = +2). This metric is intentionally weighted low as stars can be gamed and do not always reflect code quality.',
  },
  {
    key: 'stackScore',
    label: 'Stack Clarity (max 10)',
    weight: '10%',
    description: 'Measures whether a technical identity is legible. A primary language used in 2+ repos signals specialization (+6). Having ≤4 distinct languages shows focus (+4); too many languages may suggest a scattered portfolio. A beginner with 1 clear language still scores reasonably here.',
  },
];

// ─── GRADE SYSTEM ─────────────────────────────────────────────────────────────
// Maps total score (0–100) to a letter grade with a label.
// Breakpoints are aligned to natural quartiles of the scoring model.
function getGrade(score) {
  if (score >= 88) return { grade: 'A+', label: 'Excellent Portfolio',   color: '#52d48b' };
  if (score >= 78) return { grade: 'A',  label: 'Strong Portfolio',      color: '#52d48b' };
  if (score >= 68) return { grade: 'B+', label: 'Good Portfolio',        color: '#7dd8a8' };
  if (score >= 55) return { grade: 'B',  label: 'Developing Portfolio',  color: '#f8c25c' };
  if (score >= 40) return { grade: 'C',  label: 'Needs Improvement',     color: '#f8a05c' };
  if (score >= 25) return { grade: 'D',  label: 'Weak Presentation',     color: '#ff738f' };
  return                 { grade: 'F',  label: 'Incomplete Portfolio',   color: '#ff5577' };
}

// ─── SCORE EXPLANATION ───────────────────────────────────────────────────────
// Generates human-readable explanation for each scoring dimension.
function buildScoreExplanations(subs, user, repos, readmeText, totalStars, totalForks) {
  const total = repos.length || 1;
  const describedRepos = repos.filter(r => r.description).length;
  const originalRepos = repos.filter(r => !r.fork).length;
  const recentlyActive = repos.filter(r => (Date.now() - new Date(r.updated_at).getTime()) / (1000*60*60*24) < 120).length;
  const topicsCount = repos.reduce((acc, r) => acc + (r.topics || []).length, 0);
  const avgTopics = (topicsCount / total).toFixed(1);

  return {
    profileScore: [
      user.avatar_url ? '✓ Avatar present (+2)' : '✗ No avatar (0/2)',
      user.bio ? `✓ Bio present (+5): "${user.bio.slice(0, 60)}${user.bio.length > 60 ? '…' : ''}"` : '✗ No bio (0/5) — add one to explain your focus',
      user.location ? `✓ Location set (+2): ${user.location}` : '✗ No location (0/2)',
      (user.blog || user.company || user.twitter_username) ? '✓ External link or company present (+4)' : '✗ No external links or company (0/4)',
      readmeText ? '✓ Profile README found (+7) — strong first impression' : '✗ No profile README (0/7) — highest single impact improvement',
    ],
    repoQuality: [
      `${describedRepos}/${total} repos have descriptions (+${Math.round((describedRepos/total)*10)}/10)`,
      `${originalRepos}/${total} repos are original, non-forked (+${Math.round((originalRepos/total)*10)}/10)`,
      repos.some(r => (r.stargazers_count||0) >= 1) ? '✓ At least one starred repo (+5)' : '✗ No repos have stars yet (0/5)',
    ],
    docsScore: [
      readmeText ? '✓ Profile README present (+8)' : '✗ No profile README (0/8)',
      parseFloat(avgTopics) > 1 ? `✓ Good topic coverage: ${avgTopics} avg topics/repo (+5)` : `⚠ Low topic coverage: ${avgTopics} avg topics/repo (+2) — add tags to repos`,
      `${describedRepos}/${total} repos described (+${Math.round((describedRepos/total)*7)}/7)`,
    ],
    activityScore: [
      `${recentlyActive}/${total} repos updated in last 120 days (+${Math.round((recentlyActive/total)*10)}/10)`,
      repos.length >= 3 ? `✓ Portfolio depth: ${repos.length} public repos (+5)` : `⚠ Only ${repos.length} public repos — publish more to show depth (0/5)`,
    ],
    signalsScore: [
      totalStars > 10 ? `✓ Strong stars: ${totalStars} total (+6)` : totalStars > 0 ? `⚠ Some stars: ${totalStars} total (+3)` : '✗ No stars yet (0/6)',
      totalForks > 5 ? `✓ Strong forks: ${totalForks} total (+4)` : totalForks > 0 ? `⚠ Some forks: ${totalForks} total (+2)` : '✗ No forks yet (0/4)',
    ],
    stackScore: (() => {
      const langs = {};
      repos.forEach(r => { if (r.language) langs[r.language] = (langs[r.language]||0)+1; });
      const top = Object.entries(langs).sort((a,b)=>b[1]-a[1]);
      const lines = [];
      if (top.length && top[0][1] >= 2) lines.push(`✓ Clear primary language: ${top[0][0]} (${top[0][1]} repos) (+6)`);
      else if (top.length) lines.push(`⚠ No repeated primary language yet — specialize in one stack to signal expertise (+4 if consistent)`);
      else lines.push('✗ No language data — make sure repos have code (+0)');
      lines.push(top.length <= 4 ? `✓ Focused stack: ${top.length} distinct languages (+4)` : `⚠ Broad stack: ${top.length} languages — consider focusing to signal expertise (+2)`);
      return lines;
    })(),
  };
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────

function LogoSvg(){
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.8 6.2L21 11l-6.2 2.8L12 20l-2.8-6.2L3 11l6.2-2.8L12 2z"></path>
      <path d="M12 6v12M6 12h12"></path>
    </svg>
  );
}

function yearsSince(dateString){
  const created = new Date(dateString);
  const now = new Date();
  const years = Math.max(0, Math.floor((now - created) / (365.25 * 24 * 60 * 60 * 1000)));
  return years === 0 ? '<1y' : `${years}y`;
}

function ringColor(score){
  if(score >= 78) return '#52d48b';
  if(score >= 55) return '#f8c25c';
  return '#ff738f';
}

// ─── SECURITY: Sanitize README HTML output to prevent XSS ────────────────────
// Strips script tags, event handlers, and dangerous href patterns.
// This is a lightweight client-side sanitizer. For production, use DOMPurify.
function sanitizeHtml(html) {
  // Remove script tags and content
  let safe = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Remove event handlers (onclick, onerror, etc.)
  safe = safe.replace(/ on\w+="[^"]*"/gi, '');
  safe = safe.replace(/ on\w+='[^']*'/gi, '');
  // Remove javascript: href/src values
  safe = safe.replace(/href="javascript:[^"]*"/gi, 'href="#"');
  safe = safe.replace(/src="javascript:[^"]*"/gi, 'src=""');
  // Remove <iframe>, <embed>, <object>, <form>
  safe = safe.replace(/<(iframe|embed|object|form)[\s\S]*?<\/\1>/gi, '');
  safe = safe.replace(/<(iframe|embed|object|form)[^>]*\/?>/gi, '');
  return safe;
}

async function fetchJson(url){
  const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json' } });
  if(!res.ok){
    if(res.status === 404) throw new Error('GitHub user not found.');
    if(res.status === 403) throw new Error('GitHub API rate limit reached. Try again later.');
    throw new Error('Could not fetch GitHub data.');
  }
  return await res.json();
}

async function fetchText(url){
  const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github.raw+json, application/vnd.github.v3.raw' } });
  if(!res.ok) return '';
  return await res.text();
}

// ─── REPO HEALTH SCORE ───────────────────────────────────────────────────────
// Per-repo quality signal (0–100). Used for ranking, not portfolio total.
function repoHealth(repo){
  let score = 0;
  if (repo.description) score += 18;
  if (repo.homepage) score += 6;
  if (!repo.fork) score += 12;
  if (repo.stargazers_count > 0) score += Math.min(18, repo.stargazers_count * 2);
  if (repo.forks_count > 0) score += Math.min(12, repo.forks_count * 2);
  if (repo.topics && repo.topics.length) score += Math.min(10, repo.topics.length * 2);
  const days = (Date.now() - new Date(repo.updated_at).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 60) score += 16;
  else if (days < 180) score += 10;
  if (repo.language) score += 8;
  return Math.min(100, score);
}


// ─── ADVANCED ANALYTICS HELPERS ─────────────────────────────────────────────
// These are explainable rule-based signals. They are designed for portfolio
// analytics and research workflows, not for final hiring decisions.
function repoTextBlob(repo){
  return `${repo.name || ''} ${repo.description || ''} ${(repo.topics || []).join(' ')} ${repo.language || ''}`.toLowerCase();
}

function classifyRepo(repo){
  const text = repoTextBlob(repo);
  const rules = [
    { label: 'Developer Tool', keywords: ['github', 'analyzer', 'developer', 'portfolio', 'cli', 'tool', 'scope', 'metrics'] },
    { label: 'Dashboard', keywords: ['dashboard', 'admin', 'lifeos', 'tracker', 'analytics', 'productivity'] },
    { label: 'Academic Tool', keywords: ['cgpa', 'gpa', 'university', 'student', 'academic', 'exam', 'education'] },
    { label: 'Business Tool', keywords: ['business', 'startup', 'validator', 'market', 'idea', 'buildkorbo'] },
    { label: 'Game', keywords: ['game', 'loop', 'canvas', 'puzzle', 'play'] },
    { label: 'API / Backend', keywords: ['api', 'server', 'backend', 'express', 'node', 'database', 'auth'] },
    { label: 'Portfolio', keywords: ['portfolio', 'personal website', 'resume', 'cv'] },
  ];
  for (const rule of rules){
    if(rule.keywords.some(k => text.includes(k))) return rule.label;
  }
  if(repo.homepage) return 'Web Project';
  return 'General Project';
}

function repoDepth(repo){
  const days = (Date.now() - new Date(repo.updated_at).getTime()) / (1000 * 60 * 60 * 24);
  const checks = [
    { key:'description', label:'Description', pass:!!repo.description, weight:16, note: repo.description ? 'Explains project purpose' : 'Add a concise one-line purpose' },
    { key:'live', label:'Live / Demo Link', pass:!!repo.homepage, weight:14, note: repo.homepage ? 'Demo link available' : 'Add deployment/demo URL if possible' },
    { key:'topics', label:'Topics / Tags', pass:!!(repo.topics && repo.topics.length), weight:14, note: repo.topics && repo.topics.length ? `${repo.topics.length} topic(s) added` : 'Add stack and category topics' },
    { key:'recent', label:'Recently Updated', pass:days < 120, weight:14, note: days < 120 ? 'Shows current momentum' : 'Consider polishing or archiving' },
    { key:'original', label:'Original Work', pass:!repo.fork, weight:14, note: !repo.fork ? 'Original repository' : 'Forked repository' },
    { key:'language', label:'Language Detected', pass:!!repo.language, weight:10, note: repo.language ? repo.language : 'No main language detected' },
    { key:'stars', label:'Peer Signal', pass:(repo.stargazers_count||0) > 0, weight:10, note: (repo.stargazers_count||0) > 0 ? `${repo.stargazers_count} star(s)` : 'No stars yet' },
    { key:'forks', label:'Reuse Signal', pass:(repo.forks_count||0) > 0, weight:8, note: (repo.forks_count||0) > 0 ? `${repo.forks_count} fork(s)` : 'No forks yet' },
  ];
  const score = Math.min(100, checks.reduce((sum, c) => sum + (c.pass ? c.weight : 0), 0));
  const label = score >= 75 ? 'Showcase Ready' : score >= 55 ? 'Promising' : score >= 35 ? 'Needs Polish' : 'Weak Presentation';
  return { score, label, checks };
}

function getMomentum(repos){
  const total = Math.max(repos.length, 1);
  const within60 = repos.filter(r => (Date.now() - new Date(r.updated_at).getTime()) / (1000*60*60*24) < 60).length;
  const within120 = repos.filter(r => (Date.now() - new Date(r.updated_at).getTime()) / (1000*60*60*24) < 120).length;
  const score = Math.min(100, Math.round((within60/total)*60 + (within120/total)*40));
  const label = score >= 70 ? 'Active Momentum' : score >= 40 ? 'Moderate Momentum' : 'Low Momentum';
  return { score, label, within60, within120 };
}

function buildCareerFit(scores, skills, repos, topLangs){
  const repoText = repos.map(repoTextBlob).join(' ');
  const hasReact = skills.includes('React') || repoText.includes('react');
  const hasFrontend = skills.includes('Frontend') || hasReact || repoText.includes('ui') || repoText.includes('tailwind');
  const hasBackend = skills.includes('Backend') || skills.includes('Node.js') || repoText.includes('api') || repoText.includes('server') || repoText.includes('express');
  const hasTools = repoText.includes('github') || repoText.includes('analyzer') || repoText.includes('tool');
  const hasDashboard = repoText.includes('dashboard') || repoText.includes('analytics') || repoText.includes('tracker');
  const hasAcademic = repoText.includes('cgpa') || repoText.includes('student') || repoText.includes('academic');

  const fits = [];
  if(hasFrontend) fits.push({ role:'Frontend Developer', confidence: Math.min(95, 45 + scores.stackScore*4 + scores.docsScore) });
  if(hasFrontend && hasBackend) fits.push({ role:'Full-Stack Developer', confidence: Math.min(92, 40 + scores.repoQuality*1.4 + scores.stackScore*3) });
  if(hasTools) fits.push({ role:'Developer Tools Builder', confidence: Math.min(94, 52 + scores.repoQuality + scores.docsScore) });
  if(hasDashboard) fits.push({ role:'Product-focused Developer', confidence: Math.min(90, 48 + scores.repoQuality + scores.activityScore) });
  if(hasAcademic) fits.push({ role:'Student Developer / Academic Tools', confidence: Math.min(88, 45 + scores.docsScore + scores.activityScore) });
  if(scores.signalsScore >= 6) fits.push({ role:'Open Source Contributor', confidence: Math.min(86, 50 + scores.signalsScore*4) });
  if(!fits.length) fits.push({ role:'Software Engineering Intern', confidence: Math.min(75, 45 + scores.repoQuality) });
  return fits.sort((a,b) => b.confidence - a.confidence).slice(0,5);
}

function buildAdvancedAnalytics(repos, subs, topLangs, skills){
  const radar = {
    Profile: Math.round((subs.profileScore / SCORE_META.profileScore.max) * 100),
    'Repo Quality': Math.round((subs.repoQuality / SCORE_META.repoQuality.max) * 100),
    Documentation: Math.round((subs.docsScore / SCORE_META.docsScore.max) * 100),
    Activity: Math.round((subs.activityScore / SCORE_META.activityScore.max) * 100),
    'Community Signals': Math.round((subs.signalsScore / SCORE_META.signalsScore.max) * 100),
    'Stack Clarity': Math.round((subs.stackScore / SCORE_META.stackScore.max) * 100),
  };
  const classifiedRepos = repos.map(r => ({ ...r, category: classifyRepo(r), depth: repoDepth(r) }));
  const categoryCounts = classifiedRepos.reduce((acc, r) => {
    acc[r.category] = (acc[r.category] || 0) + 1;
    return acc;
  }, {});
  const categoryDistribution = Object.entries(categoryCounts).sort((a,b)=>b[1]-a[1]);
  const dominantCategory = categoryDistribution[0] ? categoryDistribution[0][0] : 'Unknown';
  const momentum = getMomentum(repos);
  const careerFits = buildCareerFit(subs, skills, repos, topLangs);
  const riskSignals = [];
  if(radar.Documentation < 55) riskSignals.push('Documentation needs improvement before strong reviewer confidence.');
  if(radar.Activity < 45) riskSignals.push('Public activity momentum appears low from visible repo updates.');
  if(radar['Community Signals'] < 35) riskSignals.push('Community validation is limited; stars/forks are not strong yet.');
  if(categoryDistribution.length <= 1 && repos.length > 3) riskSignals.push('Project variety is limited; portfolio may look narrow.');
  if(!riskSignals.length) riskSignals.push('No major risk signal detected from public data.');
  const interviewPrompts = [
    'Which project best represents your engineering decisions and why?',
    'How do you decide whether a repository is showcase-ready?',
    'What tradeoffs did you make between UI polish, performance, and maintainability?',
    `Your dominant project category appears to be ${dominantCategory}. Is that intentional?`,
  ];
  return { radar, classifiedRepos, categoryDistribution, dominantCategory, momentum, careerFits, riskSignals, interviewPrompts };
}

// ─── CORE ANALYSIS ENGINE ─────────────────────────────────────────────────────
function buildAnalysis(user, repos, readmeText){
  const languages = {};
  let totalStars = 0, totalForks = 0;
  let describedRepos = 0, recentlyActive = 0, originalRepos = 0, topicsCount = 0;

  repos.forEach((r) => {
    if (r.language) languages[r.language] = (languages[r.language] || 0) + 1;
    totalStars += r.stargazers_count || 0;
    totalForks += r.forks_count || 0;
    if (r.description) describedRepos++;
    if (!r.fork) originalRepos++;
    if ((Date.now() - new Date(r.updated_at).getTime()) / (1000*60*60*24) < 120) recentlyActive++;
    topicsCount += (r.topics || []).length;
  });

  // ── DIMENSION 1: Profile Completeness (max 20) ──
  const profileScore = Math.min(20,
    (user.avatar_url ? 2 : 0) +
    (user.bio ? 5 : 0) +
    (user.location ? 2 : 0) +
    (user.blog || user.company || user.twitter_username ? 4 : 0) +
    (readmeText ? 7 : 0)
  );

  // ── DIMENSION 2: Repository Quality (max 25) ──
  // Description ratio (0-10) + originality ratio (0-10) + star bonus (0-5)
  const repoQuality = Math.min(25,
    Math.round((describedRepos / Math.max(repos.length, 1)) * 10) +
    Math.round((originalRepos  / Math.max(repos.length, 1)) * 10) +
    (repos.some(r => (r.stargazers_count||0) >= 1) ? 5 : 0)
  );

  // ── DIMENSION 3: Documentation (max 20) ──
  // README (0-8) + topics density (2 or 5) + description ratio (0-7)
  const avgTopicsPerRepo = topicsCount / Math.max(repos.length, 1);
  const docsScore = Math.min(20,
    (readmeText ? 8 : 0) +
    (avgTopicsPerRepo > 1 ? 5 : 2) +
    Math.round((describedRepos / Math.max(repos.length, 1)) * 7)
  );

  // ── DIMENSION 4: Activity & Momentum (max 15) ──
  // Recent update ratio (0-10) + portfolio depth bonus (0-5)
  const activityScore = Math.min(15,
    Math.round((recentlyActive / Math.max(repos.length, 1)) * 10) +
    (repos.length >= 3 ? 5 : 2)
  );

  // ── DIMENSION 5: Community Signals (max 10) ──
  // Star signal (0-6) + fork signal (0-4)
  let signalsScore = 0;
  if (totalStars > 10) signalsScore += 6;
  else if (totalStars > 0) signalsScore += 3;
  if (totalForks > 5) signalsScore += 4;
  else if (totalForks > 0) signalsScore += 2;
  signalsScore = Math.min(10, signalsScore);

  // ── DIMENSION 6: Stack Clarity (max 10) ──
  // Primary language consistency (0-6) + focus vs scatter (2 or 4)
  const topLangs = Object.entries(languages).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const stackScore = Math.min(10,
    (topLangs.length ? (topLangs[0][1] >= 2 ? 6 : 4) : 0) +
    (topLangs.length && topLangs.length <= 4 ? 4 : 2)
  );

  // ── TOTAL & GRADE ──
  const total = Math.min(100, profileScore + repoQuality + docsScore + activityScore + signalsScore + stackScore);
  const gradeInfo = getGrade(total);

  // ── SKILLS INFERENCE ──
  const repoText = repos.map(r => `${r.name} ${r.description||''} ${(r.topics||[]).join(' ')}`.toLowerCase()).join(' ');
  const langNames = topLangs.map(([k]) => k.toLowerCase());
  const skills = [];
  if (langNames.includes('javascript') || langNames.includes('typescript')) skills.push('Frontend');
  if (repoText.includes('react')) skills.push('React');
  if (repoText.includes('api') || langNames.includes('python') || langNames.includes('java')) skills.push('Backend');
  if (langNames.includes('python')) skills.push('Python');
  if (repoText.includes('node')) skills.push('Node.js');
  if (repoText.includes('tailwind') || repoText.includes('ui')) skills.push('UI Design');
  if (repoText.includes('docker') || repoText.includes('deploy')) skills.push('Deployment');
  if (!skills.length && topLangs.length) skills.push(topLangs[0][0]);

  // ── STRENGTHS & WEAKNESSES ──
  const strengths = [];
  const weaknesses = [];
  const fit = [];

  if (recentlyActive >= 1) strengths.push('Recent public activity suggests active development.');
  if (describedRepos >= Math.max(2, Math.ceil(repos.length/2))) strengths.push('Repository descriptions make projects easier to review.');
  if (topLangs.length && topLangs[0][1] >= 2) strengths.push(`Clear ${topLangs[0][0]} focus across public repositories.`);
  if (readmeText) strengths.push('Profile README creates a strong first impression.');
  if (totalStars > 10) strengths.push(`${totalStars} total stars — visible community validation.`);
  if (!strengths.length) strengths.push('Public work is visible — keep adding and polishing repos.');

  if (!readmeText) weaknesses.push('No profile README — highest single impact improvement available.');
  if (totalStars < 3) weaknesses.push('Popularity signals are still limited across the profile.');
  if (!user.bio) weaknesses.push('Bio could better explain developer focus and strengths.');
  if (describedRepos < repos.length / 2) weaknesses.push('Many repos lack descriptions — hard for recruiters to skim.');
  if (topicsCount === 0) weaknesses.push('No repository topics/tags — add them to improve discoverability.');
  if (!weaknesses.length) weaknesses.push('No critical gaps detected — focus on flagship project polish.');

  if (skills.includes('Frontend') || skills.includes('React')) {
    fit.push('Junior Frontend Developer', 'Frontend Internship', 'Web Developer');
  } else if (skills.includes('Python') || skills.includes('Backend')) {
    fit.push('Junior Backend Developer', 'Python Developer', 'Software Engineering Intern');
  } else {
    fit.push('Junior Developer', 'Software Engineering Intern', 'Open Source Contributor');
  }

  // ── METRIC-DRIVEN RECRUITER SUMMARY ──
  // Generated from actual measured signals, not canned text
  const recruiterSummary = buildRecruiterSummary(
    total, gradeInfo, user, readmeText, totalStars, describedRepos, repos.length, recentlyActive, topLangs
  );

  // ── SUGGESTIONS ──
  const suggestions = [];
  if (!readmeText) suggestions.push('Add a profile README — a pinned introduction with skills, projects, and contact info improves recruiter first impressions most.');
  if (describedRepos < Math.max(2, repos.length/2)) suggestions.push('Write clear one-sentence descriptions for your key repositories. Recruiters skim — descriptions help them stop.');
  if (topicsCount === 0) suggestions.push('Add repository topics/tags (e.g. "react", "api", "machine-learning") to highlight stack and purpose.');
  if (recentlyActive < Math.max(1, repos.length/3)) suggestions.push('Update or polish at least 2–3 older repos — fresh update timestamps signal ongoing activity.');
  if (totalStars === 0) suggestions.push('Pin and present your strongest 3–4 projects to improve first-page visibility.');
  if (!user.bio) suggestions.push('Add a short bio to your GitHub profile — even 1–2 sentences about what you build helps enormously.');
  if (!suggestions.length) suggestions.push('Keep shipping. Refine README quality on your top 2 repos and consider pinning a flagship project.');

  // ── TOP REPOS ──
  const topRepos = [...repos]
    .sort((a,b) => repoHealth(b) - repoHealth(a) || (b.stargazers_count - a.stargazers_count))
    .slice(0, 6)
    .map(r => ({ ...r, health: repoHealth(r), category: classifyRepo(r), depth: repoDepth(r) }));

  // ── ACTIVITY TREND ──
  // Note: This tracks repo update events by month, NOT commit counts.
  // The GitHub public API does not expose commit frequency without authentication.
  const activity = Array.from({length:12}).map((_,i) => {
    const month = new Date();
    month.setMonth(month.getMonth() - (11 - i));
    const label = month.toLocaleString('en', { month: 'short' });
    const count = repos.filter(r => {
      const d = new Date(r.updated_at);
      return d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();
    }).length;
    return { label, value: count };
  });

  // ── HEATMAP ──
  // ESTIMATED: GitHub's contribution graph requires GraphQL API with authentication.
  // This heatmap is a visual approximation seeded from repo update patterns.
  // It is clearly labeled in the UI as "Estimated". Do not use for research data.
  const heat = Array.from({length:126}).map((_,i) => {
    const seed = (i * 17 + repos.length * 13 + totalStars * 3) % 10;
    return seed > 8 ? 4 : seed > 6 ? 3 : seed > 3 ? 2 : seed > 1 ? 1 : 0;
  });

  // ── SCORE EXPLANATIONS ──
  const scoreExplanations = buildScoreExplanations(
    { profileScore, repoQuality, docsScore, activityScore, signalsScore, stackScore },
    user, repos, readmeText, totalStars, totalForks
  );

  const advanced = buildAdvancedAnalytics(
    repos,
    { profileScore, repoQuality, docsScore, activityScore, signalsScore, stackScore },
    topLangs,
    [...new Set(skills)].slice(0, 8)
  );

  return {
    user, repos, readmeText, totalStars, totalForks, total,
    grade: gradeInfo,
    // Keep 'label' for backwards compat
    label: gradeInfo.label,
    strengths, weaknesses, fit, recruiterSummary, suggestions, topRepos,
    languages: topLangs, skills: [...new Set(skills)].slice(0, 8),
    subs: { profileScore, repoQuality, docsScore, activityScore, signalsScore, stackScore },
    scoreExplanations, advanced,
    activity, heat,
  };
}

// Generates a metric-driven recruiter summary paragraph
function buildRecruiterSummary(total, gradeInfo, user, readmeText, totalStars, describedRepos, repoCount, recentlyActive, topLangs) {
  const parts = [];
  const name = user.name || user.login;

  if (total >= 78) {
    parts.push(`${name}'s GitHub portfolio is well-structured and recruiter-friendly, earning a grade of ${gradeInfo.grade}.`);
  } else if (total >= 55) {
    parts.push(`${name}'s portfolio shows solid technical intent with a grade of ${gradeInfo.grade}, though there are clear presentation gaps.`);
  } else {
    parts.push(`${name}'s portfolio is early-stage (grade ${gradeInfo.grade}) and would benefit significantly from documentation and presentation work.`);
  }

  if (topLangs.length) parts.push(`Primary language stack: ${topLangs.slice(0,3).map(([k])=>k).join(', ')}.`);
  if (recentlyActive > 0) parts.push(`${recentlyActive} of ${repoCount} repos were updated in the last 4 months, indicating active development.`);
  if (totalStars > 5) parts.push(`${totalStars} total stars across public repos suggests some community recognition.`);
  if (!readmeText) parts.push(`No profile README is present — a critical gap for recruiter first impressions.`);
  if (describedRepos < repoCount / 2) parts.push(`Fewer than half of repos have descriptions, which increases cognitive load for reviewers.`);

  return parts.join(' ');
}

// ─── COMPONENTS ───────────────────────────────────────────────────────────────

function ScoreRing({ score, grade }){
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const center = size / 2;
    const radius = 88;
    let frame = 0;
    let raf = null;
    const color = grade.color;

    function draw(val){
      ctx.clearRect(0,0,size,size);

      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(125,141,255,.10)';
      ctx.lineWidth = 16;
      ctx.stroke();

      const end = (-Math.PI/2) + (Math.PI*2)*(val/100);
      ctx.beginPath();
      ctx.arc(center, center, radius, -Math.PI/2, end);
      ctx.strokeStyle = color;
      ctx.lineWidth = 16;
      ctx.lineCap = 'round';
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#111a3a';
      ctx.font = '900 58px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(val), center, center - 8);

      ctx.fillStyle = color;
      ctx.font = '900 27px Inter';
      ctx.fillText(grade.grade, center, center + 42);
    }

    function step(){
      frame += 1;
      const val = Math.min(score, score * (frame / 26));
      draw(val);
      if (val < score) raf = requestAnimationFrame(step);
    }
    step();
    return () => cancelAnimationFrame(raf);
  }, [score, grade]);

  return <canvas ref={ref} width="260" height="260"></canvas>;
}

function ChartCard({ eyebrow, title, note, buildChart, deps }){
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !window.Chart) return;
    const chart = buildChart(ref.current.getContext('2d'));
    return () => chart && chart.destroy && chart.destroy();
  }, deps);

  return (
    <div className="card fade">
      <div className="card-inner">
        <div className="eyebrow">{eyebrow}</div>
        <h3 style={{marginTop:12}}>{title}</h3>
        {note && <p style={{margin:'4px 0 8px', color:'var(--muted)', fontSize:'.85rem'}}>{note}</p>}
        <div className="chart-holder">
          <canvas ref={ref}></canvas>
        </div>
      </div>
    </div>
  );
}

function RepoModal({ repo, onClose }){
  if(!repo) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e)=>e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">Repository Details</div>
            <h2 style={{margin:'12px 0 6px', letterSpacing:'-.04em'}}>{repo.name}</h2>
            <div style={{color:'var(--muted)'}}>{repo.description || 'No description added yet.'}</div>
            <div className="badge-row">
              <span className="badge">⭐ {repo.stargazers_count}</span>
              <span className="badge">🍴 {repo.forks_count}</span>
              <span className="badge">🧠 Health {repo.health}/100</span>
              {repo.language && <span className="badge">{repo.language}</span>}
              {repo.homepage && <span className="badge">🔗 Live</span>}
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="grid-2" style={{marginTop:0}}>
            <div className="info-box">
              <h4>Quick Overview</h4>
              <ul>
                <li>Updated: {new Date(repo.updated_at).toLocaleDateString()}</li>
                <li>Visibility: Public</li>
                <li>Fork: {repo.fork ? 'Yes — inherited codebase' : 'No — original work'}</li>
                <li>Homepage / Demo: {repo.homepage ? <a href={repo.homepage} target="_blank" rel="noreferrer" style={{color:'var(--accent)'}}>{repo.homepage.slice(0,40)}</a> : 'Not set'}</li>
                <li>Topics: {repo.topics && repo.topics.length ? repo.topics.join(', ') : 'None added'}</li>
              </ul>
            </div>
            <div className="info-box">
              <h4>Recruiter Notes</h4>
              <ul>
                <li>{repo.description ? '✓ Has a readable description.' : '✗ Needs a clearer description.'}</li>
                <li>{repo.homepage ? '✓ Live/demo link available — strong signal.' : '⚠ No live link — consider deploying or linking a demo.'}</li>
                <li>{repo.topics && repo.topics.length ? `✓ ${repo.topics.length} topic(s) — good for discoverability.` : '⚠ No topics — add tags like the language or framework.'}</li>
                <li>{repo.health >= 70 ? '✓ Looks showcase-ready.' : repo.health >= 45 ? '⚠ Decent, but can be polished.' : '✗ Needs presentation and docs work.'}</li>
                <li>{repo.stargazers_count > 0 ? `✓ ${repo.stargazers_count} star(s) — some popularity signal.` : '⚠ No stars yet — share and pin to gain visibility.'}</li>
              </ul>
            </div>
          </div>
          <RepoDepthBreakdown repo={repo} />
          <div className="info-box" style={{marginTop:18}}>
            <h4>Open on GitHub</h4>
            <a className="btn" href={repo.html_url} target="_blank" rel="noreferrer" style={{display:'inline-block'}}>Open Repository →</a>
          </div>
        </div>
      </div>
    </div>
  );
}

// Score explanation accordion component
function ScoreExplainer({ subs, scoreExplanations }){
  const [open, setOpen] = useState(null);
  const keys = Object.keys(SCORE_META);

  return (
    <div className="card fade" style={{marginTop:20}}>
      <div className="card-inner">
        <div className="eyebrow">Score Breakdown</div>
        <h3 style={{marginTop:12}}>Why you got this score</h3>
        <p style={{color:'var(--muted)', marginTop:4, marginBottom:16, fontSize:'.9rem'}}>Click each dimension to see the specific signals that contributed to your score.</p>
        <div style={{display:'grid', gap:10}}>
          {keys.map(key => {
            const meta = SCORE_META[key];
            const val = subs[key];
            const pct = Math.round((val / meta.max) * 100);
            const color = pct >= 75 ? 'var(--success)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)';
            const isOpen = open === key;
            return (
              <div key={key}
                style={{borderRadius:14, border:'1px solid rgba(125,141,255,.14)', background:'rgba(255,255,255,.02)', overflow:'hidden', cursor:'pointer'}}
                onClick={() => setOpen(isOpen ? null : key)}
              >
                <div style={{display:'flex', alignItems:'center', gap:14, padding:'14px 16px'}}>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:8}}>
                      <span style={{fontWeight:600}}>{meta.label}</span>
                      <span style={{color, fontWeight:700}}>{val}/{meta.max}</span>
                    </div>
                    <div style={{height:6, borderRadius:999, background:'rgba(20,35,90,.06)'}}>
                      <div style={{height:'100%', width:`${pct}%`, borderRadius:999, background:color, transition:'width .6s ease'}}></div>
                    </div>
                  </div>
                  <span style={{color:'var(--muted)', fontSize:'.8rem'}}>{isOpen ? '▲' : '▼'}</span>
                </div>
                {isOpen && (
                  <div style={{padding:'0 16px 14px', borderTop:'1px solid rgba(125,141,255,.08)'}}>
                    <ul style={{margin:'10px 0 0', paddingLeft:18, color:'#4b5878', fontSize:'.9rem', lineHeight:1.7}}>
                      {(scoreExplanations[key] || []).map((line,i) => (
                        <li key={i} style={{marginBottom:4}}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Methodology panel — explains the scoring model
function MethodologyPanel(){
  const [open, setOpen] = useState(false);
  return (
    <div className="card fade" style={{marginTop:20}}>
      <div className="card-inner">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer'}} onClick={() => setOpen(v => !v)}>
          <div>
            <div className="eyebrow">Methodology</div>
            <h3 style={{marginTop:8, marginBottom:0}}>Scoring Methodology</h3>
          </div>
          <span style={{color:'var(--muted)'}}>{open ? '▲ Hide' : '▼ View'}</span>
        </div>

        {open && (
          <div style={{marginTop:18}}>
            <div className="info-box" style={{marginBottom:14}}>
              <h4>Overview</h4>
              <p style={{margin:0, color:'#35405f', lineHeight:1.7}}>
                GitScope evaluates GitHub profiles using a transparent, rule-based scoring model across 6 weighted dimensions (total: 100 points).
                All metrics are derived from the GitHub public REST API. No authentication is required, but some signals (e.g., actual commit counts,
                private contribution history) are not accessible and are noted as limitations.
              </p>
            </div>

            <div className="info-box" style={{marginBottom:14}}>
              <h4>Data Used by GitScope</h4>
              <p style={{margin:0, color:'#35405f', lineHeight:1.7}}>
                GitScope uses publicly available GitHub profile and repository data, including profile details, public repositories, repository descriptions, languages, stars, forks, update activity, and profile README content.
              </p>
              <p style={{margin:'10px 0 0', color:'#35405f', lineHeight:1.7}}>
                Private repositories, private contributions, employer codebases, and organization-only work are not included in the analysis.
              </p>
            </div>

            <div className="info-box" style={{marginBottom:14}}>
              <h4>Scoring Dimensions</h4>
              <div style={{display:'grid', gap:10, marginTop:8}}>
                {METHODOLOGY.map(m => (
                  <div key={m.key} style={{padding:'12px 14px', borderRadius:12, background:'rgba(125,141,255,.04)', border:'1px solid rgba(125,141,255,.10)'}}>
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:6}}>
                      <strong>{m.label}</strong>
                      <span style={{color:'var(--accent)', fontWeight:600}}>{m.weight}</span>
                    </div>
                    <p style={{margin:0, color:'var(--muted)', fontSize:'.88rem', lineHeight:1.65}}>{m.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="info-box" style={{marginBottom:14}}>
              <h4>Grade System</h4>
              <div style={{display:'flex', flexWrap:'wrap', gap:8, marginTop:8}}>
                {[
                  {grade:'A+', range:'88–100', label:'Excellent'},
                  {grade:'A',  range:'78–87',  label:'Strong'},
                  {grade:'B+', range:'68–77',  label:'Good'},
                  {grade:'B',  range:'55–67',  label:'Developing'},
                  {grade:'C',  range:'40–54',  label:'Needs Improvement'},
                  {grade:'D',  range:'25–39',  label:'Weak Presentation'},
                  {grade:'F',  range:'0–24',   label:'Incomplete'},
                ].map(g => (
                  <span key={g.grade} style={{padding:'8px 12px', borderRadius:999, background:'rgba(125,141,255,.08)', border:'1px solid rgba(125,141,255,.16)', fontSize:'.88rem'}}>
                    <strong>{g.grade}</strong> ({g.range}) — {g.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="info-box">
              <h4>Known Limitations</h4>
              <ul style={{margin:0, paddingLeft:18, color:'#35405f', lineHeight:1.8}}>
                <li>GitHub public activity does not represent private contributions, work repos, or employer codebases.</li>
                <li>Stars and forks can be inflated and do not always correlate with code quality.</li>
                <li>The contribution heatmap shown in GitScope is <strong>estimated</strong> — real contribution graphs require authenticated GraphQL access.</li>
                <li>Activity chart shows repo <em>update events</em>, not commit counts — the public API does not expose commit frequency without auth.</li>
                <li>Documentation quality is inferred from presence signals, not content analysis.</li>
                <li>Portfolio score reflects public presentation only and may underrepresent highly productive developers with private or organizational repos.</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}



// Research paper standard documentation inside the app
function ResearchValidationPanel(){
  const [open, setOpen] = useState(false);
  const rubric = [
    {score:'1', label:'Very weak', note:'Sparse or unclear portfolio; little evidence of usable projects.'},
    {score:'2', label:'Weak', note:'Some public work exists, but presentation and documentation are limited.'},
    {score:'3', label:'Average', note:'Several projects exist with moderate clarity and some useful signals.'},
    {score:'4', label:'Strong', note:'Clear technical identity, polished projects, and good documentation.'},
    {score:'5', label:'Excellent', note:'Highly polished public portfolio with strong activity, documentation, and project depth.'},
  ];
  return (
    <div className="card fade research-panel" style={{marginTop:20}}>
      <div className="card-inner">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer', gap:12}} onClick={() => setOpen(v => !v)}>
          <div>
            <div className="eyebrow">Validation Framework</div>
            <h3 style={{marginTop:8, marginBottom:0}}>Validation analytics framework</h3>
          </div>
          <span style={{color:'var(--muted)'}}>{open ? '▲ Hide' : '▼ View'}</span>
        </div>

        {open && (
          <div style={{marginTop:18}}>
            <div className="info-box" style={{marginBottom:14}}>
              <h4>Research Title</h4>
              <p style={{margin:0, color:'#35405f', lineHeight:1.7}}>
                <strong>A Framework for Evaluating Developer Portfolios Using GitHub Repository Analytics</strong>
              </p>
            </div>

            <div className="info-box" style={{marginBottom:14}}>
              <h4>Research Question</h4>
              <p style={{margin:0, color:'#35405f', lineHeight:1.7}}>
                Can GitHub activity, repository documentation, community signals, and stack clarity be used to estimate developer portfolio quality?
              </p>
            </div>

            <div className="info-box" style={{marginBottom:14}}>
              <h4>Scoring Formula</h4>
              <div className="formula-box">S = 0.20P + 0.25R + 0.20D + 0.15A + 0.10C + 0.10T</div>
              <ul style={{margin:'12px 0 0', paddingLeft:18, color:'#35405f', lineHeight:1.8}}>
                <li><strong>P</strong> = Profile Completeness</li>
                <li><strong>R</strong> = Repository Quality</li>
                <li><strong>D</strong> = Documentation Quality</li>
                <li><strong>A</strong> = Activity & Momentum</li>
                <li><strong>C</strong> = Community Signals</li>
                <li><strong>T</strong> = Stack Clarity</li>
              </ul>
            </div>

            <div className="info-box" style={{marginBottom:14}}>
              <h4>Human Reviewer Rubric</h4>
              <div className="rubric-grid">
                {rubric.map(r => (
                  <div className="rubric-card" key={r.score}>
                    <strong>{r.score} — {r.label}</strong>
                    <span>{r.note}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="info-box" style={{marginBottom:14}}>
              <h4>Validation Workflow</h4>
              <ol style={{margin:0, paddingLeft:18, color:'#35405f', lineHeight:1.8}}>
                <li>Collect 50–100 public GitHub usernames from students, junior developers, and open-source contributors.</li>
                <li>Run Dataset Mode and export CSV/JSON.</li>
                <li>Ask 3–5 human reviewers to score each portfolio using the rubric above.</li>
                <li>Compare GitScope scores against averaged human scores.</li>
                <li>Report average absolute difference and correlation in the research write-up.</li>
              </ol>
            </div>

            <div className="info-box">
              <h4>Research Limitations</h4>
              <ul style={{margin:0, paddingLeft:18, color:'#35405f', lineHeight:1.8}}>
                <li>GitHub profiles do not fully represent developer ability.</li>
                <li>Private contributions and organization work may be hidden.</li>
                <li>Stars and forks may reflect popularity rather than code quality.</li>
                <li>README and topics are presentation signals, not full proof of engineering skill.</li>
                <li>Unauthenticated GitHub API limits deep commit-level analysis.</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ─── DATASET MODE ───────────────────────────────────────────────────────────
// Batch analysis for research data collection. This reuses the existing
// fetchBundle/buildAnalysis pipeline so single-profile scoring and dataset
// scoring remain consistent.
function downloadFile(filename, content, type='text/plain'){
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value){
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function datasetRowFromAnalysis(a){
  return {
    username: a.user.login,
    name: a.user.name || '',
    total_score: a.total,
    grade: a.grade.grade,
    grade_label: a.grade.label,
    profile_score: a.subs.profileScore,
    repo_quality: a.subs.repoQuality,
    documentation_score: a.subs.docsScore,
    activity_score: a.subs.activityScore,
    community_signals: a.subs.signalsScore,
    stack_clarity: a.subs.stackScore,
    public_repos: a.user.public_repos,
    followers: a.user.followers,
    total_stars: a.totalStars,
    total_forks: a.totalForks,
    top_languages: a.languages.map(([k,v]) => `${k}:${v}`).join('; '),
    inferred_skills: a.skills.join('; '),
    best_fit: a.fit[0] || '',
    primary_fit: a.advanced?.careerFits?.[0]?.role || '',
    fit_confidence: a.advanced?.careerFits?.[0]?.confidence || '',
    momentum_label: a.advanced?.momentum?.label || '',
    momentum_score: a.advanced?.momentum?.score || '',
    dominant_category: a.advanced?.dominantCategory || '',
    category_distribution: (a.advanced?.categoryDistribution || []).map(([k,v]) => `${k}:${v}`).join('; '),
    radar_profile: a.advanced?.radar?.Profile || '',
    radar_repo_quality: a.advanced?.radar?.['Repo Quality'] || '',
    radar_documentation: a.advanced?.radar?.Documentation || '',
    radar_activity: a.advanced?.radar?.Activity || '',
    radar_community: a.advanced?.radar?.['Community Signals'] || '',
    radar_stack: a.advanced?.radar?.['Stack Clarity'] || '',
    has_profile_readme: a.readmeText ? 'yes' : 'no',
    recruiter_summary: a.recruiterSummary,
  };
}


// ─── VALIDATION ANALYTICS ───────────────────────────────────────────────────
// These helpers compare GitScope scores against optional human reviewer scores.
function validationPairs(rows){
  return rows
    .filter(r => !r.error && typeof r.total_score === 'number' && r.human_score !== '' && !isNaN(Number(r.human_score)))
    .map(r => ({ username:r.username, g:Number(r.total_score), h:Number(r.human_score), diff:Number(r.total_score)-Number(r.human_score) }));
}

function mean(values){
  return values.length ? values.reduce((a,b)=>a+b,0) / values.length : 0;
}

function std(values){
  if(values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a,v)=>a+Math.pow(v-m,2),0) / (values.length-1));
}

function pearsonCorrelation(pairs){
  if(pairs.length < 2) return null;
  const xs = pairs.map(p=>p.h);
  const ys = pairs.map(p=>p.g);
  const mx = mean(xs), my = mean(ys);
  const num = pairs.reduce((a,p)=>a+(p.h-mx)*(p.g-my),0);
  const denX = Math.sqrt(xs.reduce((a,x)=>a+Math.pow(x-mx,2),0));
  const denY = Math.sqrt(ys.reduce((a,y)=>a+Math.pow(y-my,2),0));
  if(!denX || !denY) return null;
  return num / (denX * denY);
}

function rankValues(values){
  const sorted = values.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v);
  const ranks = Array(values.length);
  for(let i=0;i<sorted.length;i++){
    let j=i;
    while(j+1<sorted.length && sorted[j+1].v===sorted[i].v) j++;
    const avgRank = (i + j + 2) / 2;
    for(let k=i;k<=j;k++) ranks[sorted[k].i] = avgRank;
    i=j;
  }
  return ranks;
}

function spearmanCorrelation(pairs){
  if(pairs.length < 2) return null;
  const humanRanks = rankValues(pairs.map(p=>p.h));
  const gitRanks = rankValues(pairs.map(p=>p.g));
  return pearsonCorrelation(pairs.map((p,i)=>({ h:humanRanks[i], g:gitRanks[i] })));
}

function correlationLabel(r){
  if(r === null || isNaN(r)) return 'Not enough human scores';
  const abs = Math.abs(r);
  if(abs >= .70) return 'Strong agreement';
  if(abs >= .40) return 'Moderate agreement';
  if(abs >= .20) return 'Weak agreement';
  return 'Very weak agreement';
}

function validationMetrics(rows){
  const pairs = validationPairs(rows);
  const diffs = pairs.map(p=>p.diff);
  const absDiffs = diffs.map(Math.abs);
  const squared = diffs.map(d=>d*d);
  const pearson = pearsonCorrelation(pairs);
  const spearman = spearmanCorrelation(pairs);
  return {
    pairs,
    reviewed: pairs.length,
    avgGitScope: pairs.length ? mean(pairs.map(p=>p.g)) : null,
    avgHuman: pairs.length ? mean(pairs.map(p=>p.h)) : null,
    mae: pairs.length ? mean(absDiffs) : null,
    rmse: pairs.length ? Math.sqrt(mean(squared)) : null,
    bias: pairs.length ? mean(diffs) : null,
    pearson,
    spearman,
    stdGitScope: pairs.length > 1 ? std(pairs.map(p=>p.g)) : null,
    stdHuman: pairs.length > 1 ? std(pairs.map(p=>p.h)) : null,
  };
}

function formatMetric(v, digits=2){
  return v === null || v === undefined || isNaN(v) ? '—' : Number(v).toFixed(digits);
}

function ValidationAnalyticsPanel({ rows, exportValidationReport }){
  const metrics = useMemo(() => validationMetrics(rows), [rows]);
  const pairs = metrics.pairs;
  if(!rows.length) return null;

  const diffBuckets = [
    {label:'≤5',  count:pairs.filter(p=>Math.abs(p.diff)<=5).length},
    {label:'6–10', count:pairs.filter(p=>Math.abs(p.diff)>5 && Math.abs(p.diff)<=10).length},
    {label:'11–20', count:pairs.filter(p=>Math.abs(p.diff)>10 && Math.abs(p.diff)<=20).length},
    {label:'>20', count:pairs.filter(p=>Math.abs(p.diff)>20).length},
  ];

  return (
    <div className="card fade" style={{marginTop:20}}>
      <div className="card-inner">
        <div className="eyebrow">Validation Analytics</div>
        <h3 style={{marginTop:12}}>GitScope score vs human reviewer score</h3>
        <p style={{color:'var(--muted)', lineHeight:1.7, marginTop:4}}>
          Add human scores in the Dataset table to unlock correlation, error metrics, score distributions, and a validation report. This is the experimental layer for research evaluation.
        </p>

        <div className="validation-summary-grid">
          <div className="stat"><div className="stat-label">Reviewed Profiles</div><div className="stat-value">{metrics.reviewed}</div></div>
          <div className="stat"><div className="stat-label">Pearson r</div><div className="stat-value small">{formatMetric(metrics.pearson)}</div></div>
          <div className="stat"><div className="stat-label">Spearman ρ</div><div className="stat-value small">{formatMetric(metrics.spearman)}</div></div>
          <div className="stat"><div className="stat-label">MAE</div><div className="stat-value small">{formatMetric(metrics.mae)}</div></div>
          <div className="stat"><div className="stat-label">RMSE</div><div className="stat-value small">{formatMetric(metrics.rmse)}</div></div>
          <div className="stat"><div className="stat-label">Bias</div><div className="stat-value small">{formatMetric(metrics.bias)}</div></div>
        </div>

        <div className="info-box" style={{marginTop:16}}>
          <h4>Interpretation</h4>
          <ul>
            <li>Pearson correlation: <strong>{correlationLabel(metrics.pearson)}</strong></li>
            <li>Spearman correlation: <strong>{correlationLabel(metrics.spearman)}</strong></li>
            <li>MAE means average absolute score difference between GitScope and human reviewers.</li>
            <li>Bias &gt; 0 means GitScope scores higher than humans on average; Bias &lt; 0 means GitScope is stricter.</li>
          </ul>
        </div>

        {pairs.length >= 2 ? (
          <div className="grid-2">
            <ChartCard
              eyebrow="Validation Scatter"
              title="Human score vs GitScope score"
              note="Each point represents one reviewed GitHub profile. Closer to the diagonal means better agreement."
              deps={[JSON.stringify(pairs)]}
              buildChart={ctx => new Chart(ctx, {
                type:'scatter',
                data:{
                  datasets:[
                    { label:'Reviewed Profiles', data:pairs.map(p=>({x:p.h,y:p.g})), backgroundColor:'#5de4c7', pointRadius:5 },
                    { label:'Perfect Agreement', type:'line', data:[{x:0,y:0},{x:100,y:100}], borderColor:'rgba(248,194,92,.75)', borderDash:[6,6], pointRadius:0, fill:false }
                  ]
                },
                options:{
                  responsive:true,
                  maintainAspectRatio:false,
                  plugins:{ legend:{ labels:{ color:'#35405f' } } },
                  scales:{
                    x:{ min:0, max:100, title:{ display:true, text:'Human Score', color:'#35405f' }, ticks:{ color:'#637090' }, grid:{ color:'rgba(125,141,255,.08)' } },
                    y:{ min:0, max:100, title:{ display:true, text:'GitScope Score', color:'#35405f' }, ticks:{ color:'#637090' }, grid:{ color:'rgba(125,141,255,.08)' } }
                  }
                }
              })}
            />

            <ChartCard
              eyebrow="Error Distribution"
              title="Absolute difference buckets"
              note="Lower buckets mean stronger alignment with human reviewers."
              deps={[JSON.stringify(diffBuckets)]}
              buildChart={ctx => new Chart(ctx, {
                type:'bar',
                data:{ labels:diffBuckets.map(b=>b.label), datasets:[{ label:'Profiles', data:diffBuckets.map(b=>b.count), backgroundColor:'rgba(125,141,255,.58)', borderColor:'#7d8dff', borderWidth:1, borderRadius:10 }] },
                options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{ ticks:{ color:'#637090' }, grid:{ color:'rgba(125,141,255,.08)' } }, y:{ ticks:{ color:'#637090', precision:0 }, grid:{ color:'rgba(125,141,255,.08)' } } } }
              })}
            />
          </div>
        ) : (
          <div className="empty" style={{marginTop:12}}>Add at least 2 human reviewer scores to generate validation charts.</div>
        )}

        <div className="validation-actions">
          <button className="btn-secondary" disabled={!pairs.length} onClick={exportValidationReport}>Export Validation Report</button>
        </div>
      </div>
    </div>
  );
}

function DatasetMode({ fetchBundle, apiMode, apiBase, notify }){
  const [input, setInput] = useState('musfiqsama\ntorvalds\ngaearon');
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const usernames = useMemo(() => [...new Set(input.split(/[\n,]+/).map(x => x.trim()).filter(Boolean))], [input]);

  async function runDataset(){
    if(!usernames.length) return;
    setRunning(true);
    setError('');
    setRows([]);
    const nextRows = [];

    for(let i=0; i<usernames.length; i++){
      const name = usernames[i];
      setProgress(`Analyzing ${i+1}/${usernames.length}: ${name}`);
      try{
        const analysis = await fetchBundle(name);
        nextRows.push({ ...datasetRowFromAnalysis(analysis), human_score: '', error: '' });
      }catch(e){
        nextRows.push({ username: name, error: e.message || 'Failed to analyze', human_score: '' });
      }
      setRows([...nextRows]);
      // Small delay helps avoid rapid unauthenticated API bursts.
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    setProgress(`Completed ${nextRows.length} profile(s).`);
    setRunning(false);
  }

  function updateHumanScore(index, value){
    setRows(prev => prev.map((row, i) => i === index ? { ...row, human_score: value } : row));
  }

  const validRows = rows.filter(r => !r.error && typeof r.total_score === 'number');
  const rowsWithHuman = validRows.filter(r => r.human_score !== '' && !isNaN(Number(r.human_score)));
  const avgGitScope = validRows.length ? validRows.reduce((a,r)=>a+r.total_score,0) / validRows.length : 0;
  const avgHuman = rowsWithHuman.length ? rowsWithHuman.reduce((a,r)=>a+Number(r.human_score),0) / rowsWithHuman.length : 0;
  const avgDiff = rowsWithHuman.length ? rowsWithHuman.reduce((a,r)=>a+Math.abs(r.total_score - Number(r.human_score)),0) / rowsWithHuman.length : 0;

  const exportRows = rows.map(r => {
    if(r.error) return { username:r.username, error:r.error, human_score:r.human_score || '' };
    const human = r.human_score === '' ? '' : Number(r.human_score);
    return {
      ...r,
      human_score: r.human_score,
      score_difference: human === '' || isNaN(human) ? '' : r.total_score - human,
      absolute_difference: human === '' || isNaN(human) ? '' : Math.abs(r.total_score - human),
    };
  });

  function exportCSV(){
    if(!exportRows.length) return;
    const headers = [
      'username','name','total_score','grade','grade_label','profile_score','repo_quality','documentation_score','activity_score','community_signals','stack_clarity','public_repos','followers','total_stars','total_forks','top_languages','inferred_skills','best_fit','primary_fit','fit_confidence','momentum_label','momentum_score','dominant_category','category_distribution','radar_profile','radar_repo_quality','radar_documentation','radar_activity','radar_community','radar_stack','has_profile_readme','human_score','score_difference','absolute_difference','error','recruiter_summary'
    ];
    const lines = [headers.join(',')];
    exportRows.forEach(row => lines.push(headers.map(h => csvEscape(row[h])).join(',')));
    downloadFile(`gitscope_dataset_${new Date().toISOString().slice(0,10)}.csv`, lines.join('\n'), 'text/csv');
  }

  function exportJSON(){
    if(!exportRows.length) return;
    const payload = {
      generated_at: new Date().toISOString(),
      tool: 'GitScope',
      research_title: 'A Framework for Evaluating Developer Portfolios Using GitHub Repository Analytics',
      rows: exportRows,
      summary: {
        profiles_requested: usernames.length,
        profiles_analyzed: validRows.length,
        failed_profiles: rows.filter(r => r.error).length,
        average_gitscope_score: Number(avgGitScope.toFixed(2)),
        human_scores_available: rowsWithHuman.length,
        average_human_score: rowsWithHuman.length ? Number(avgHuman.toFixed(2)) : null,
        average_absolute_difference: rowsWithHuman.length ? Number(avgDiff.toFixed(2)) : null,
        validation: validationMetrics(rows),
      }
    };
    downloadFile(`gitscope_dataset_${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }

  function exportValidationReport(){
    const metrics = validationMetrics(rows);
    const pairs = metrics.pairs;
    const report = [
      '# GitScope Validation Report',
      '',
      `Generated at: ${new Date().toISOString()}`,
      '',
      '## Research Title',
      'A Framework for Evaluating Developer Portfolios Using GitHub Repository Analytics',
      '',
      '## Dataset Summary',
      `Profiles requested: ${usernames.length}`,
      `Profiles analyzed successfully: ${validRows.length}`,
      `Failed profiles: ${rows.filter(r => r.error).length}`,
      `Human-reviewed profiles: ${metrics.reviewed}`,
      '',
      '## Validation Metrics',
      `Average GitScope score: ${formatMetric(metrics.avgGitScope)}`,
      `Average human score: ${formatMetric(metrics.avgHuman)}`,
      `Pearson correlation: ${formatMetric(metrics.pearson)} (${correlationLabel(metrics.pearson)})`,
      `Spearman correlation: ${formatMetric(metrics.spearman)} (${correlationLabel(metrics.spearman)})`,
      `MAE: ${formatMetric(metrics.mae)}`,
      `RMSE: ${formatMetric(metrics.rmse)}`,
      `Bias: ${formatMetric(metrics.bias)}`,
      '',
      '## Reviewed Profiles',
      ...pairs.map(p => `- ${p.username}: GitScope=${p.g}, Human=${p.h}, Difference=${p.diff.toFixed(2)}`),
      '',
      '## Interpretation Guide',
      '- Pearson/Spearman >= 0.70: strong agreement',
      '- 0.40–0.70: moderate agreement',
      '- < 0.40: weak agreement',
      '- Lower MAE/RMSE means better alignment with human judgment.',
      '',
      '## Limitations',
      '- Human reviewer scores may be subjective.',
      '- GitHub public data does not include private repositories or private contributions.',
      '- Stars/forks may reflect popularity rather than code quality.',
      '- GitScope evaluates public portfolio presentation, not complete developer ability.',
    ].join('\n');
    downloadFile(`gitscope_validation_report_${new Date().toISOString().slice(0,10)}.md`, report, 'text/markdown');
  }

  async function saveDatasetToBackend(){
    if(apiMode !== 'backend'){
      alert('Switch API mode to Backend before saving datasets.');
      return;
    }
    if(!exportRows.length) return;
    try{
      const payload = {
        name: `GitScope Dataset ${new Date().toLocaleDateString()}`,
        usernames,
        rows: exportRows,
        summary: {
          profiles_requested: usernames.length,
          profiles_analyzed: validRows.length,
          failed_profiles: rows.filter(r => r.error).length,
          average_gitscope_score: Number(avgGitScope.toFixed(2)),
          human_scores_available: rowsWithHuman.length,
          average_human_score: rowsWithHuman.length ? Number(avgHuman.toFixed(2)) : null,
          average_absolute_difference: rowsWithHuman.length ? Number(avgDiff.toFixed(2)) : null,
          validation: validationMetrics(rows),
        }
      };
      await apiRequest(apiBase, '/api/datasets', { method:'POST', body: JSON.stringify(payload) });
      notify ? notify('Dataset saved successfully') : alert('Dataset saved successfully');
    }catch(e){
      notify ? notify(e.message || 'Could not save. Check backend connection.') : alert(e.message || 'Could not save dataset.');
    }
  }

  return (
    <div className="card fade" style={{marginTop:20}}>
      <div className="card-inner">
        <div className="eyebrow">Dataset + Validation</div>
        <h3 style={{marginTop:12}}>Research data collection + validation</h3>
        <p style={{color:'var(--muted)', lineHeight:1.7, marginTop:4}}>
          Analyze multiple GitHub usernames with the same scoring engine, add optional human reviewer scores, and export CSV/JSON for validation. Use reviewer scores to compare GitScope output with human judgment.
        </p>
        <div className="score-guide">
          <strong>Human score guide:</strong> 0-29 Weak · 30-49 Developing · 50-69 Average · 70-84 Strong · 85-100 Excellent
        </div>

        <div className="dataset-grid">
          <div>
            <label className="dataset-label">GitHub usernames</label>
            <textarea
              className="dataset-textarea"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={'one username per line\nexample: musfiqsama'}
            />
            <div className="dataset-actions">
              <button className="btn" disabled={running || !usernames.length} onClick={runDataset}>{running ? 'Analyzing…' : `Analyze ${usernames.length || 0} Profile(s)`}</button>
              <button className="btn-secondary" disabled={!rows.length} onClick={exportCSV}>Export CSV</button>
              <button className="btn-secondary" disabled={!rows.length} onClick={exportJSON}>Export JSON</button>
              <button className="btn-secondary" disabled={!rows.length || apiMode !== 'backend'} onClick={saveDatasetToBackend}>Save Dataset</button>
            </div>
            {progress && <p className="dataset-progress">{progress}</p>}
            {error && <p style={{color:'var(--danger)'}}>{error}</p>}
          </div>

          <div className="dataset-summary">
            <div className="stat"><div className="stat-label">Profiles Analyzed</div><div className="stat-value">{validRows.length}</div></div>
            <div className="stat"><div className="stat-label">Avg GitScope Score</div><div className="stat-value">{validRows.length ? avgGitScope.toFixed(1) : '—'}</div></div>
            <div className="stat"><div className="stat-label">Human Scores</div><div className="stat-value">{rowsWithHuman.length}</div></div>
            <div className="stat"><div className="stat-label">Avg Abs Difference</div><div className="stat-value">{rowsWithHuman.length ? avgDiff.toFixed(1) : '—'}</div></div>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="dataset-table-wrap">
            <table className="dataset-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Score</th>
                  <th>Grade</th>
                  <th>Profile</th>
                  <th>Repo</th>
                  <th>Docs</th>
                  <th>Activity</th>
                  <th>Signals</th>
                  <th>Stack</th>
                  <th>Repos</th>
                  <th>Stars</th>
                  <th>Followers</th>
                  <th>Top Languages</th>
                  <th>Best Fit</th>
                  <th>Career Fit</th>
                  <th>Momentum</th>
                  <th>Category</th>
                  <th>Human Score</th>
                  <th>Diff</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r,i) => {
                  const human = r.human_score === '' ? '' : Number(r.human_score);
                  const diff = human === '' || isNaN(human) || typeof r.total_score !== 'number' ? '' : r.total_score - human;
                  return (
                    <tr key={`${r.username}-${i}`} className={r.error ? 'dataset-error-row' : ''}>
                      <td><strong>{r.username}</strong>{r.error && <div className="dataset-error">{r.error}</div>}</td>
                      <td>{r.error ? '—' : r.total_score}</td>
                      <td>{r.error ? '—' : r.grade}</td>
                      <td>{r.error ? '—' : r.profile_score}</td>
                      <td>{r.error ? '—' : r.repo_quality}</td>
                      <td>{r.error ? '—' : r.documentation_score}</td>
                      <td>{r.error ? '—' : r.activity_score}</td>
                      <td>{r.error ? '—' : r.community_signals}</td>
                      <td>{r.error ? '—' : r.stack_clarity}</td>
                      <td>{r.error ? '—' : r.public_repos}</td>
                      <td>{r.error ? '—' : r.total_stars}</td>
                      <td>{r.error ? '—' : r.followers}</td>
                      <td>{r.error ? '—' : r.top_languages}</td>
                      <td>{r.error ? '—' : r.best_fit}</td>
                      <td>{r.error ? '—' : `${r.primary_fit} ${r.fit_confidence ? `(${r.fit_confidence}%)` : ''}`}</td>
                      <td>{r.error ? '—' : `${r.momentum_label} ${r.momentum_score ? `(${r.momentum_score})` : ''}`}</td>
                      <td>{r.error ? '—' : r.dominant_category}</td>
                      <td>
                        <input className="human-score-input" type="number" min="0" max="100" value={r.human_score} onChange={e => updateHumanScore(i, e.target.value)} placeholder="0-100" />
                      </td>
                      <td>{diff === '' ? '—' : diff.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <ValidationAnalyticsPanel rows={rows} exportValidationReport={exportValidationReport} />

        <div className="info-box" style={{marginTop:16}}>
          <h4>Suggested research workflow</h4>
          <ul>
            <li>Collect 50–100 public GitHub usernames.</li>
            <li>Run Dataset Mode and export CSV.</li>
            <li>Ask 3–5 human reviewers to score the same profiles from 0–100.</li>
            <li>Use validation analytics to inspect correlation, MAE, RMSE, bias, scatter plot, and error distribution.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}


function AdvancedAnalyticsPanel({ analysis }){
  if(!analysis || !analysis.advanced) return null;
  const radarLabels = Object.keys(analysis.advanced.radar);
  const radarValues = radarLabels.map(k => analysis.advanced.radar[k]);
  return (
    <>
      <div className="grid-2">
        <ChartCard
          eyebrow="Portfolio Radar"
          title="Portfolio maturity radar"
          note="Normalized 0–100 view of the six GitScope scoring dimensions."
          deps={[JSON.stringify(analysis.advanced.radar)]}
          buildChart={ctx => new Chart(ctx, {
            type:'radar',
            data:{
              labels:radarLabels,
              datasets:[{
                label:'Dimension Strength',
                data:radarValues,
                borderColor:'#5de4c7',
                backgroundColor:'rgba(93,228,199,.14)',
                pointBackgroundColor:'#7d8dff',
                pointBorderWidth:0
              }]
            },
            options:{
              responsive:true,
              maintainAspectRatio:false,
              plugins:{ legend:{ labels:{ color:'#35405f' } } },
              scales:{ r:{ min:0, max:100, ticks:{ color:'#637090', backdropColor:'transparent' }, grid:{ color:'rgba(125,141,255,.13)' }, angleLines:{ color:'rgba(125,141,255,.13)' }, pointLabels:{ color:'#35405f', font:{ size:12 } } } }
            }
          })}
        />

        <ChartCard
          eyebrow="Project Categories"
          title="Repository type distribution"
          note="Rule-based classification from repo names, descriptions, topics, and language."
          deps={[JSON.stringify(analysis.advanced.categoryDistribution)]}
          buildChart={ctx => new Chart(ctx, {
            type:'bar',
            data:{
              labels:analysis.advanced.categoryDistribution.map(([k]) => k),
              datasets:[{
                label:'Repos',
                data:analysis.advanced.categoryDistribution.map(([,v]) => v),
                backgroundColor:'rgba(125,141,255,.55)',
                borderColor:'#7d8dff',
                borderWidth:1,
                borderRadius:10
              }]
            },
            options:{
              responsive:true,
              maintainAspectRatio:false,
              plugins:{ legend:{ display:false } },
              scales:{
                x:{ ticks:{ color:'#637090' }, grid:{ display:false } },
                y:{ ticks:{ color:'#637090', precision:0 }, grid:{ color:'rgba(125,141,255,.08)' } }
              }
            }
          })}
        />
      </div>

      <div className="grid-3 advanced-insights">
        <div className="card fade">
          <div className="card-inner">
            <div className="eyebrow">Career Fit Engine</div>
            <h3 style={{marginTop:12}}>Role fit confidence</h3>
            <div className="fit-list">
              {analysis.advanced.careerFits.map((fit,i) => (
                <div className="fit-item" key={i}>
                  <div style={{display:'flex', justifyContent:'space-between', gap:12}}>
                    <strong>{fit.role}</strong>
                    <span>{fit.confidence}%</span>
                  </div>
                  <div className="mini-bar"><span style={{width:`${fit.confidence}%`}}></span></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card fade">
          <div className="card-inner">
            <div className="eyebrow">Momentum</div>
            <h3 style={{marginTop:12}}>{analysis.advanced.momentum.label}</h3>
            <p style={{color:'var(--muted)', lineHeight:1.7}}>Momentum score: <strong style={{color:'var(--accent)'}}>{analysis.advanced.momentum.score}/100</strong></p>
            <ul className="compact-list">
              <li>{analysis.advanced.momentum.within60} repo(s) updated within 60 days</li>
              <li>{analysis.advanced.momentum.within120} repo(s) updated within 120 days</li>
              <li>Dominant category: {analysis.advanced.dominantCategory}</li>
            </ul>
          </div>
        </div>

        <div className="card fade">
          <div className="card-inner">
            <div className="eyebrow">Risk Signals</div>
            <h3 style={{marginTop:12}}>Reviewer caution points</h3>
            <ul className="compact-list">
              {analysis.advanced.riskSignals.map((x,i) => <li key={i}>{x}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

function RepoDepthBreakdown({ repo }){
  if(!repo || !repo.depth) return null;
  return (
    <div className="info-box" style={{marginTop:18}}>
      <h4>Repository Depth</h4>
      <p style={{marginTop:0, color:'var(--muted)'}}>Category: <strong>{repo.category}</strong> · Depth: <strong>{repo.depth.score}/100</strong> ({repo.depth.label})</p>
      <div className="depth-grid">
        {repo.depth.checks.map(c => (
          <div className={`depth-check ${c.pass ? 'pass' : 'fail'}`} key={c.key}>
            <strong>{c.pass ? '✓' : '×'} {c.label}</strong>
            <span>{c.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Loading(){
  return (
    <div className="skeleton-row">
      <div className="skeleton-card"></div>
      <div className="skeleton-card"></div>
      <div className="skeleton-card"></div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function App(){
  const [username, setUsername] = useState('musfiqsama');
  const [compareUsername, setCompareUsername] = useState('');
  const [mode, setMode] = useState('normal');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [compareAnalysis, setCompareAnalysis] = useState(null);
  const [error, setError] = useState('');
  const [repoQuery, setRepoQuery] = useState('');
  const [langFilter, setLangFilter] = useState('all');
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [apiMode, setApiMode] = useState(() => localStorage.getItem('gitscope_api_mode') || 'backend');
  const [apiBase, setApiBase] = useState(() => localStorage.getItem('gitscope_api_base') || DEFAULT_API_BASE);
  const [toast, setToast] = useState('');

  useEffect(() => {
    handleAnalyze('musfiqsama');
  }, []);

  useEffect(() => {
    localStorage.setItem('gitscope_api_mode', apiMode);
    localStorage.setItem('gitscope_api_base', apiBase);
  }, [apiMode, apiBase]);

  function notify(message){
    setToast(message);
    window.clearTimeout(window.__gitscopeToastTimer);
    window.__gitscopeToastTimer = window.setTimeout(() => setToast(''), 2600);
  }

  async function fetchBundle(name){
    if(apiMode === 'backend'){
      const data = await apiRequest(apiBase, `/api/github/bundle/${encodeURIComponent(name)}`);
      return buildAnalysis(data.user, data.repos, data.readmeText || '');
    }
    const user = await fetchJson(`https://api.github.com/users/${name}`);
    const repos = await fetchJson(`https://api.github.com/users/${name}/repos?per_page=100&sort=updated`);
    const readmeA = await fetchText(`https://raw.githubusercontent.com/${name}/${name}/main/README.md`);
    const readmeB = readmeA || await fetchText(`https://raw.githubusercontent.com/${name}/${name}/master/README.md`);
    return buildAnalysis(user, repos, readmeB);
  }

  async function saveAnalysisToBackend(){
    if(apiMode !== 'backend'){
      notify('Switch data mode to Backend before saving analysis.');
      return;
    }
    if(!analysis) return;
    try{
      await apiRequest(apiBase, '/api/analysis', {
        method:'POST',
        body: JSON.stringify({
          username: analysis.user.login,
          name: analysis.user.name,
          total_score: analysis.total,
          grade: analysis.grade,
          subs: analysis.subs,
          top_languages: analysis.languages,
          skills: analysis.skills,
          fit: analysis.fit,
          recruiter_summary: analysis.recruiterSummary,
          momentum: analysis.momentum,
          careerFit: analysis.careerFit,
          categoryDistribution: analysis.categoryDistribution,
        })
      });
      notify('Analysis saved successfully');
    }catch(e){
      notify(e.message || 'Could not save. Check backend connection.');
    }
  }

  async function handleAnalyze(initialName){
    const mainName = (initialName || username).trim();
    if(!mainName) return;
    try{
      setError('');
      setLoading(true);
      const primary = await fetchBundle(mainName);
      setAnalysis(primary);
      if(compareUsername.trim()){
        const secondary = await fetchBundle(compareUsername.trim());
        setCompareAnalysis(secondary);
      } else {
        setCompareAnalysis(null);
      }
    } catch(e){
      setError(e.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  const filteredRepos = useMemo(() => {
    if(!analysis) return [];
    return analysis.topRepos.filter(r => {
      const matchesQuery = !repoQuery || r.name.toLowerCase().includes(repoQuery.toLowerCase()) || (r.description||'').toLowerCase().includes(repoQuery.toLowerCase());
      const matchesLang = langFilter === 'all' || r.language === langFilter;
      return matchesQuery && matchesLang;
    });
  }, [analysis, repoQuery, langFilter]);

  const allLanguages = useMemo(() => analysis ? [...new Set(analysis.topRepos.map(r => r.language).filter(Boolean))] : [], [analysis]);

  const winners = useMemo(() => {
    if(!analysis || !compareAnalysis) return [];
    const list = [];
    if(analysis.total > compareAnalysis.total) list.push(`${analysis.user.login} leads in overall portfolio score`);
    else if(compareAnalysis.total > analysis.total) list.push(`${compareAnalysis.user.login} leads in overall portfolio score`);
    if(analysis.totalStars > compareAnalysis.totalStars) list.push(`${analysis.user.login} shows stronger popularity signals`);
    else if(compareAnalysis.totalStars > analysis.totalStars) list.push(`${compareAnalysis.user.login} shows stronger popularity signals`);
    if(analysis.subs.docsScore > compareAnalysis.subs.docsScore) list.push(`${analysis.user.login} looks better documented`);
    else if(compareAnalysis.subs.docsScore > analysis.subs.docsScore) list.push(`${compareAnalysis.user.login} looks better documented`);
    return list;
  }, [analysis, compareAnalysis]);

  return (
    <div className="app">
      <div className="topbar fade">
        <div className="brand">
          <div className="logo"><img src="./assets/gitscope-icon.png" alt="GitScope logo" /></div>
          <div>
            <h1>GitScope</h1>
            <p>GitHub portfolio analyzer for developers and recruiters</p>
          </div>
        </div>

        <div className="toolbar">
          <div className="view-toggle">
            <button className={mode === 'normal' ? 'active' : ''} onClick={() => setMode('normal')}>Normal View</button>
            <button className={mode === 'recruiter' ? 'active' : ''} onClick={() => setMode('recruiter')}>Recruiter View</button>
          </div>
          <button className="btn-secondary" onClick={() => window.print()}>Export Report</button>
          <button className="btn-secondary" disabled={apiMode !== 'backend' || !analysis} onClick={saveAnalysisToBackend}>Save Analysis</button>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}

      <section className="hero fade">
        <h2>Analyze any GitHub profile</h2>
        <p>Evaluate developer portfolios, repositories, documentation, and career signals using GitHub data. Compare profiles, review maturity signals, and save research datasets when the backend is connected.</p>

        <div className="controls">
          <div className="input-wrap">
            <span>⌕</span>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter GitHub username"
              onKeyDown={e => e.key === 'Enter' && handleAnalyze()} />
          </div>

          <div className="input-wrap">
            <span>⇄</span>
            <input value={compareUsername} onChange={e => setCompareUsername(e.target.value)} placeholder="Compare username (optional)"
              onKeyDown={e => e.key === 'Enter' && handleAnalyze()} />
          </div>

          <button className="btn" onClick={() => handleAnalyze()}>Analyze Profile</button>
          <button className="btn-secondary" onClick={() => setCompareUsername(compareUsername ? '' : 'torvalds')}>
            {compareUsername ? 'Single View' : 'Compare Mode'}
          </button>
        </div>

        <div className="examples">
          {['torvalds','gaearon','vercel','kentcdodds'].map(name => (
            <button key={name} className="chip" onClick={() => { setUsername(name); handleAnalyze(name); }}>{name}</button>
          ))}
        </div>

        <div className="api-mode-panel">
          <div>
            <strong>Data Mode:</strong> <span>{apiMode === 'backend' ? 'Backend Connected' : 'Direct GitHub API'}</span>
            <p>Save analyses and datasets using MongoDB through Netlify Functions. Switch to Direct mode only if the API is unavailable.</p>
          </div>
          <div className="api-mode-controls">
            <select value={apiMode} onChange={e => setApiMode(e.target.value)}>
              <option value="direct">Direct</option>
              <option value="backend">Backend</option>
            </select>
            <input value={apiBase} onChange={e => setApiBase(e.target.value)} placeholder="Backend URL" />
          </div>
        </div>
      </section>

      <DatasetMode fetchBundle={fetchBundle} apiMode={apiMode} apiBase={apiBase} notify={notify} />

      {error && <div className="card fade"><div className="card-inner" style={{color:'var(--danger)'}}>{error}</div></div>}
      {loading && <Loading />}

      {!loading && analysis && (
        <>
          {compareAnalysis ? (
            <div className="grid-2">
              {[analysis, compareAnalysis].map(item => (
                <div className="card fade" key={item.user.login}>
                  <div className="card-inner">
                    <div className="profile-top">
                      <img className="avatar" src={item.user.avatar_url} alt={item.user.login} />
                      <div>
                        <div className="profile-name">{item.user.name || item.user.login}</div>
                        <div className="handle">@{item.user.login}</div>
                        <p className="bio">{item.user.bio || 'No bio added yet.'}</p>
                      </div>
                    </div>

                    <div className="stats">
                      <div className="stat"><div className="stat-label">Public Repositories</div><div className="stat-value">{item.user.public_repos}</div></div>
                      <div className="stat"><div className="stat-label">Followers</div><div className="stat-value">{fmt.format(item.user.followers)}</div></div>
                      <div className="stat"><div className="stat-label">Account Age</div><div className="stat-value">{yearsSince(item.user.created_at)}</div></div>
                      <div className="stat">
                        <div className="stat-label">Portfolio Score</div>
                        <div className="stat-value" style={{color: item.grade.color}}>{item.total} <span style={{fontSize:'1.1rem'}}>{item.grade.grade}</span></div>
                      </div>
                    </div>

                    <div className="info-box" style={{marginTop:16}}>
                      <h4>Recruiter View</h4>
                      <ul>
                        {item.strengths.slice(0,2).map((x,i) => <li key={i}>{x}</li>)}
                        {item.weaknesses.slice(0,1).map((x,i) => <li key={`w${i}`}>{x}</li>)}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid-3">
              {/* Card 1: Profile Summary */}
              <div className="card fade">
                <div className="card-inner">
                  <div className="eyebrow">Profile Summary</div>

                  <div className="profile-top">
                    <img className="avatar" src={analysis.user.avatar_url} alt={analysis.user.login} />
                    <div>
                      <div className="profile-name">{analysis.user.name || analysis.user.login}</div>
                      <div className="handle">@{analysis.user.login}</div>
                      <p className="bio">{analysis.user.bio || 'No bio added yet.'}</p>
                    </div>
                  </div>

                  <div className="stats">
                    <div className="stat"><div className="stat-label">Company / Org</div><div className="stat-value small">{analysis.user.company || 'Independent'}</div></div>
                    <div className="stat"><div className="stat-label">Account Created</div><div className="stat-value small">{new Date(analysis.user.created_at).toLocaleDateString()}</div></div>
                    <div className="stat"><div className="stat-label">Public Repositories</div><div className="stat-value">{analysis.user.public_repos}</div></div>
                    <div className="stat"><div className="stat-label">Followers</div><div className="stat-value">{fmt.format(analysis.user.followers)}</div></div>
                    <div className="stat"><div className="stat-label">Total Stars</div><div className="stat-value">{analysis.totalStars}</div></div>
                    <div className="stat"><div className="stat-label">Account Age</div><div className="stat-value">{yearsSince(analysis.user.created_at)}</div></div>
                  </div>
                </div>
              </div>

              {/* Card 2: Portfolio Score + Grade */}
              <div className="card fade">
                <div className="card-inner">
                  <div className="eyebrow">Portfolio Score</div>

                  <div className="score-wrap">
                    <ScoreRing score={analysis.total} grade={analysis.grade} />
                    <div style={{textAlign:'center', marginTop:2}}>
                      <span style={{color: analysis.grade.color, fontWeight:700, fontSize:'1rem'}}>{analysis.grade.label}</span>
                    </div>
                  </div>

                  <div className="score-grid">
                    {Object.entries(SCORE_META).map(([key, meta]) => {
                      const val = analysis.subs[key];
                      const pct = Math.round((val / meta.max) * 100);
                      const color = pct >= 75 ? 'var(--success)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)';
                      return (
                        <div className="score-box" key={key}>
                          <strong style={{color}}>{val}/{meta.max}</strong>
                          <span>{meta.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Card 3: Recruiter Impression */}
              <div className="card fade">
                <div className="card-inner">
                  <div className="eyebrow">Recruiter Impression</div>
                  <p className="recruiter-copy">{analysis.recruiterSummary}</p>

                  <div className="info-grid">
                    <div className="info-box">
                      <h4>Strengths</h4>
                      <ul>{analysis.strengths.map((x,i) => <li key={i}>{x}</li>)}</ul>
                    </div>
                    <div className="info-box">
                      <h4>Weaknesses</h4>
                      <ul>{analysis.weaknesses.map((x,i) => <li key={i}>{x}</li>)}</ul>
                    </div>
                    <div className="info-box">
                      <h4>Best Fit</h4>
                      <ul>{analysis.fit.map((x,i) => <li key={i}>{x}</li>)}</ul>
                    </div>
                  </div>

                  <div className="skill-row">
                    {analysis.skills.map((x,i) => <span className="skill-pill" key={i}>{x}</span>)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {compareAnalysis && winners.length > 0 && (
            <div className="card fade" style={{marginTop:20}}>
              <div className="card-inner">
                <div className="eyebrow">Compare Winners</div>
                <div className="winner-row">
                  {winners.map((w,i) => <span className="winner-pill" key={i}>{w}</span>)}
                </div>
              </div>
            </div>
          )}

          {/* Score Breakdown — why you got this score (only in single view) */}
          {!compareAnalysis && (
            <ScoreExplainer subs={analysis.subs} scoreExplanations={analysis.scoreExplanations} />
          )}

          {!compareAnalysis && <AdvancedAnalyticsPanel analysis={analysis} />}

          <div className="grid-2">
            <ChartCard
              eyebrow="Language Usage"
              title="Public stack composition"
              deps={[analysis ? JSON.stringify(analysis.languages) : '']}
              buildChart={ctx => new Chart(ctx, {
                type: 'doughnut',
                data: {
                  labels: analysis.languages.map(([k]) => k),
                  datasets: [{
                    data: analysis.languages.map(([,v]) => v),
                    backgroundColor: ['#7d8dff','#5de4c7','#f8c25c','#b38cff','#4db9ff','#7f8ab5'],
                    borderWidth: 0
                  }]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { position:'right', labels: { color:'#35405f', usePointStyle:true, pointStyle:'circle' } } }
                }
              })}
            />

            <ChartCard
              eyebrow="Activity Trend"
              title="Repository update rhythm by month"
              note="⚠ Shows repo update events, not commit counts. Commit data requires authentication."
              deps={[analysis ? JSON.stringify(analysis.activity) : '']}
              buildChart={ctx => new Chart(ctx, {
                type: 'line',
                data: {
                  labels: analysis.activity.map(x => x.label),
                  datasets: [{
                    label: 'Repo Updates',
                    data: analysis.activity.map(x => x.value),
                    borderColor: '#5de4c7',
                    backgroundColor: 'rgba(93,228,199,.12)',
                    fill: true,
                    tension: .35,
                    pointRadius: 3
                  }]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display:false } },
                  scales: {
                    x: { ticks: { color:'#637090' }, grid: { color:'rgba(125,141,255,.08)' } },
                    y: { ticks: { color:'#637090', precision:0 }, grid: { color:'rgba(125,141,255,.08)' } }
                  }
                }
              })}
            />
          </div>

          <div className="grid-2">
            {/* Heatmap — labeled as ESTIMATED */}
            <div className="card fade">
              <div className="card-inner">
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8}}>
                  <div className="eyebrow">Contribution Heatmap</div>
                  <span style={{padding:'5px 10px', borderRadius:999, background:'rgba(248,194,92,.10)', border:'1px solid rgba(248,194,92,.22)', color:'var(--warn)', fontSize:'.78rem', fontWeight:600}}>⚠ ESTIMATED</span>
                </div>
                <h3 style={{marginTop:12}}>Visual activity approximation</h3>
                <p style={{color:'var(--muted)', fontSize:'.84rem', margin:'0 0 14px'}}>This heatmap is generated from repo update patterns, not real GitHub contribution data. Real contribution graphs require authenticated GraphQL API access.</p>
                <div className="heatmap">
                  {analysis.heat.map((v,i) => <div key={i} className={`heat-cell ${v ? `l${v}` : ''}`}></div>)}
                </div>
              </div>
            </div>

            {/* Profile README — sanitized */}
            <div className="card fade">
              <div className="card-inner">
                <div className="eyebrow">Profile README</div>
                <h3 style={{marginTop:12}}>First-impression preview</h3>
                {analysis.readmeText ? (
                  <div
                    className="readme"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(marked.parse(analysis.readmeText.slice(0, 6000))) }}
                  />
                ) : (
                  <div className="empty">No profile README found for this user.<br/><span style={{fontSize:'.88rem', marginTop:6, display:'block'}}>Create a repo named exactly <code style={{background:'rgba(20,35,90,.06)', padding:'2px 5px', borderRadius:4}}>{analysis.user.login}</code> and add a README.md to it.</span></div>
                )}
              </div>
            </div>
          </div>

          {/* Top Repositories */}
          <div className="card fade" style={{marginTop:20}}>
            <div className="card-inner">
              <div className="eyebrow">Top Repositories</div>
              <h3 style={{marginTop:12}}>Repo health and showcase picks</h3>

              <div className="filter-bar">
                <input placeholder="Search repos" value={repoQuery} onChange={e => setRepoQuery(e.target.value)} />
                <select value={langFilter} onChange={e => setLangFilter(e.target.value)}>
                  <option value="all">All languages</option>
                  {allLanguages.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </div>

              <div className="repo-list">
                {filteredRepos.map(repo => (
                  <div className="repo-item" key={repo.id}>
                    <div>
                      <h4>{repo.name}</h4>
                      <p>{repo.description || 'No description added yet.'}</p>
                      <div className="repo-meta">
                        <span>{repo.language || 'Unknown'}</span>
                        <span>⭐ {repo.stargazers_count}</span>
                        <span>🍴 {repo.forks_count}</span>
                        {repo.homepage && <span>🔗 Live</span>}
                        {repo.category && <span>{repo.category}</span>}
                        <span>Updated {new Date(repo.updated_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="repo-right">
                      <span className={`health-pill ${repo.health >= 70 ? 'health-high' : repo.health >= 45 ? 'health-mid' : 'health-low'}`}>
                        Health {repo.health}
                      </span>
                      <button className="repo-btn" onClick={() => setSelectedRepo(repo)}>Details</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid-2">
            {/* Suggestions */}
            <div className="card fade">
              <div className="card-inner">
                <div className="eyebrow">Improvement Suggestions</div>
                <h3 style={{marginTop:12}}>Prioritized action items</h3>
                <div className="repo-list" style={{marginTop:14}}>
                  {analysis.suggestions.map((s,i) => (
                    <div className="repo-item" key={i}>
                      <div>
                        <h4>Action {i + 1}</h4>
                        <p>{s}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Recruiter Mode extended panel */}
            {mode === 'recruiter' && (
              <div className="card fade">
                <div className="card-inner">
                  <div className="eyebrow">Recruiter Mode</div>

                  <div className="info-box" style={{marginTop:14}}>
                    <h4>10-second summary</h4>
                    <ul>
                      <li>{analysis.recruiterSummary}</li>
                      <li>Portfolio grade: <strong style={{color: analysis.grade.color}}>{analysis.grade.grade} — {analysis.grade.label}</strong></li>
                      <li>Best suited for: {analysis.fit[0]}</li>
                      <li>Hiring confidence: {analysis.total >= 78 ? 'Strong junior candidate' : analysis.total >= 55 ? 'Promising candidate' : 'Needs polish before strong shortlist'}</li>
                    </ul>
                  </div>

                  <div className="info-box" style={{marginTop:14}}>
                    <h4>Risk signals</h4>
                    <ul>
                      {analysis.advanced.riskSignals.map((x,i) => <li key={i}>{x}</li>)}
                    </ul>
                  </div>

                  <div className="info-box" style={{marginTop:14}}>
                    <h4>Interview talking points</h4>
                    <ul>
                      {analysis.advanced.interviewPrompts.map((x,i) => <li key={i}>{x}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Scoring Methodology — Research panel */}
          <MethodologyPanel />
          <ResearchValidationPanel />

          <div className="footer">Made by Musfiqur Rahman Sama</div>
        </>
      )}

      <RepoModal repo={selectedRepo} onClose={() => setSelectedRepo(null)} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
