/**
 * C-Social seed script
 * Generates realistic sample data: 100 users, 2000 posts, ~5000 likes, ~3000 comments
 *
 * Usage (run from project root):
 *   node database/seed.js
 *
 * Requires .env in apps/backend/ with DB credentials.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../apps/backend/.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const NUM_USERS    = 100;
const NUM_POSTS    = 2000;
const LIKES_PER_POST_AVG = 2.5;  // ~5000 total likes
const COMMENTS_PER_POST_AVG = 1.5; // ~3000 total comments

// ── Realistic data pools ──────────────────────────────────────────────────────

const firstNames = [
  'Alex','Jordan','Morgan','Taylor','Casey','Riley','Avery','Quinn','Sage','Blake',
  'Cameron','Drew','Emery','Finley','Harley','Jamie','Kendall','Logan','Marlowe','Noel',
  'Parker','Reese','Skyler','Spencer','Sydney','Tyler','Rowan','Dakota','Elliot','Frankie',
  'Hadley','Indigo','Jesse','Kieran','Lennox','Micah','Nova','Oakley','Peyton','Robin',
  'Sawyer','Tatum','Uma','Vesper','Winter','Xander','Yael','Zara','Brier','Clover'
];

const lastNames = [
  'Martinez','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Wilson','Moore',
  'Taylor','Anderson','Thomas','Jackson','White','Harris','Martin','Thompson','Young','Walker',
  'Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores','Green','Adams',
  'Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts','Phillips','Evans',
  'Turner','Parker','Collins','Edwards','Stewart','Sanchez','Morris','Rogers','Reed','Cook'
];

const emailDomains = ['gmail.com','yahoo.com','outlook.com','icloud.com','proton.me','hey.com'];

const postTemplates = [
  'Just shipped a new feature and it actually works on the first try. ',
  'Hot take: {opinion}',
  'Anyone else dealing with {problem}? How do you handle it?',
  'Today I learned that {fact}. Mind = blown.',
  'Current mood: {mood}',
  'PSA: {tip}',
  'Working on a {project} and it\'s going {status}. Send help.',
  'Unpopular opinion: {opinion}',
  'Three things I wish I knew earlier: 1) {tip} 2) Rest is productive. 3) Ask for help sooner.',
  'Finally finished {project}. Only took {timespan} longer than estimated.',
  'The best debugging tool is still a good night\'s sleep.',
  'Reminder: done is better than perfect.',
  'Coffee count: {number}. Lines of code written: also {number}. Coincidence? I think not.',
  'Why does {problem} still exist in {year}? Asking for a friend.',
  'Just refactored some code from 2 years ago. Past me owes present me an apology.',
  'New blog post dropping soon about {topic}. Stay tuned.',
  'Spent 3 hours on a bug. It was a missing semicolon. I\'m fine.',
  'Learning {technology} this week. It\'s actually not that bad once you get past the docs.',
  'To everyone grinding late tonight — you got this.',
  'Shoutout to everyone who writes clear commit messages. You are the real MVPs.',
];

const opinions = [
  'tabs are better than spaces','dark mode is overrated','TypeScript isn\'t worth the overhead',
  'sprints should be 3 weeks','code reviews should be async','CSS is a real programming language',
  'meetings could be emails','pair programming is underrated','documentation is the real product'
];

const problems = [
  'merge conflicts','scope creep','imposter syndrome','dependency hell','legacy code',
  'unclear requirements','timezone scheduling','slow CI pipelines','context switching'
];

const facts = [
  'HTTP 418 is a real status code','git blame is actually useful','vim has a built-in file explorer',
  'you can pipe anything in Linux','CSS has a :has() selector now','JSON doesn\'t support comments'
];

const moods = [
  'debugging at 2am','deep in the zone','questioning all my life choices',
  'powered by caffeine and spite','cautiously optimistic','ship it and pray'
];

const tips = [
  'read the error message first','write the test before the code','commit early and often',
  'name your variables like your coworkers will read them','sleep on hard problems',
  'Google is not cheating','asking questions is a superpower'
];

const projects = [
  'side project','CLI tool','REST API','React app','data pipeline','browser extension',
  'Discord bot','portfolio site','open source library','internal dashboard'
];

const technologies = [
  'Rust','Go','Svelte','Bun','Deno','WebAssembly','GraphQL','Kubernetes','Redis','Terraform'
];

const topics = [
  'system design','testing strategies','career growth','open source contributing',
  'developer burnout','API design','database indexing','CSS architecture','monorepos'
];

const timespans = ['2x','3x','5x','way','significantly'];
const statuses  = ['surprisingly well','okay I guess','sideways','nowhere fast','pretty great'];

const commentPool = [
  'This is so relatable 😂',
  'Totally agree with this!',
  'Been there. It gets better.',
  'Wait, this actually happened to me last week.',
  'The {technology} one really hits different.',
  'This should have more likes.',
  'Needed to hear this today.',
  'Sending this to my whole team.',
  'Facts. 100%.',
  'The struggle is real.',
  'Okay but why is this so accurate',
  'Preach.',
  'I felt this in my soul.',
  'Adding this to my notes app.',
  'Can confirm. Happened to me on a Friday afternoon.',
  'The documentation part 💀',
  'You forgot to mention the rubber duck step.',
  'We do not talk about the semicolons.',
  'Tabs gang rise up.',
  'Git blame is lowkey the scariest command.',
  'My team literally had this exact conversation yesterday.',
  'Bookmarking this forever.',
  'Please write more posts like this.',
  'This account is the only reason I\'m on here.',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function generatePostText() {
  let t = pick(postTemplates);
  return t
    .replace('{opinion}',    pick(opinions))
    .replace('{problem}',    pick(problems))
    .replace('{fact}',       pick(facts))
    .replace('{mood}',       pick(moods))
    .replace('{tip}',        pick(tips))
    .replace('{project}',    pick(projects))
    .replace('{status}',     pick(statuses))
    .replace('{technology}', pick(technologies))
    .replace('{topic}',      pick(topics))
    .replace('{timespan}',   pick(timespans))
    .replace('{year}',       String(randInt(2010, 2024)))
    .replace(/\{number\}/g,  String(randInt(2, 9)));
}

function generateComment() {
  return pick(commentPool).replace('{technology}', pick(technologies));
}

function randomPastDate(daysBack = 365) {
  const d = new Date();
  d.setDate(d.getDate() - randInt(0, daysBack));
  d.setHours(randInt(6, 23), randInt(0, 59), randInt(0, 59));
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  const pool = mysql.createPool({
    host:     process.env.DB_HOST     || 'localhost',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'csocial_db',
    waitForConnections: true,
    connectionLimit: 5,
  });

  console.log('Connected. Starting seed...');

  const hashedPassword = await bcrypt.hash('Password123!', 10);

  // ── Users ─────────────────────────────────────────────────────────────────
  console.log(`Inserting ${NUM_USERS} users...`);
  const userIds = [];
  const usedEmails = new Set();

  for (let i = 0; i < NUM_USERS; i++) {
    let email;
    do {
      const first = pick(firstNames).toLowerCase();
      const last  = pick(lastNames).toLowerCase();
      const suffix = randInt(1, 999);
      email = `${first}.${last}${suffix}@${pick(emailDomains)}`;
    } while (usedEmails.has(email));
    usedEmails.add(email);

    const createdAt = randomPastDate(730);
    const [result] = await pool.query(
      'INSERT INTO users (email, hashed_password, is_admin, created_at) VALUES (?, ?, 0, ?)',
      [email, hashedPassword, createdAt]
    );
    userIds.push(result.insertId);
  }
  console.log(`✓ ${userIds.length} users inserted`);

  // ── Posts ─────────────────────────────────────────────────────────────────
  console.log(`Inserting ${NUM_POSTS} posts...`);
  const postIds = [];

  const linkSamples = [
    { url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript', title: 'MDN Web Docs — JavaScript' },
    { url: 'https://css-tricks.com', title: 'CSS-Tricks' },
    { url: 'https://github.com/trending', title: 'GitHub Trending' },
    { url: 'https://news.ycombinator.com', title: 'Hacker News' },
    { url: 'https://stackoverflow.com', title: 'Stack Overflow' },
  ];

  for (let i = 0; i < NUM_POSTS; i++) {
    const userId    = pick(userIds);
    const text      = generatePostText();
    const createdAt = randomPastDate(365);
    const hasLink   = Math.random() < 0.15;
    const link      = hasLink ? pick(linkSamples) : null;

    const [result] = await pool.query(
      'INSERT INTO posts (user_id, text_content, photo_url, link_url, link_title, created_at) VALUES (?, ?, NULL, ?, ?, ?)',
      [userId, text, link?.url || null, link?.title || null, createdAt]
    );
    postIds.push(result.insertId);

    if ((i + 1) % 500 === 0) console.log(`  ${i + 1}/${NUM_POSTS} posts...`);
  }
  console.log(`✓ ${postIds.length} posts inserted`);

  // ── Likes ─────────────────────────────────────────────────────────────────
  console.log('Inserting likes...');
  const likeSet = new Set();
  let likeCount = 0;
  const targetLikes = Math.floor(NUM_POSTS * LIKES_PER_POST_AVG);

  let attempts = 0;
  while (likeCount < targetLikes && attempts < targetLikes * 5) {
    attempts++;
    const postId = pick(postIds);
    const userId = pick(userIds);
    const key    = `${postId}-${userId}`;
    if (likeSet.has(key)) continue;
    likeSet.add(key);
    const createdAt = randomPastDate(365);
    await pool.query(
      'INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)',
      [postId, userId, createdAt]
    );
    likeCount++;
  }
  console.log(`✓ ${likeCount} likes inserted`);

  // ── Comments ──────────────────────────────────────────────────────────────
  console.log('Inserting comments...');
  const targetComments = Math.floor(NUM_POSTS * COMMENTS_PER_POST_AVG);
  let commentCount = 0;

  for (let i = 0; i < targetComments; i++) {
    const postId    = pick(postIds);
    const userId    = pick(userIds);
    const text      = generateComment();
    const createdAt = randomPastDate(365);
    await pool.query(
      'INSERT INTO comments (post_id, user_id, text_content, created_at) VALUES (?, ?, ?, ?)',
      [postId, userId, text, createdAt]
    );
    commentCount++;
    if ((commentCount) % 1000 === 0) console.log(`  ${commentCount}/${targetComments} comments...`);
  }
  console.log(`✓ ${commentCount} comments inserted`);

  await pool.end();
  console.log('\nSeed complete!');
  console.log(`  Users:    ${userIds.length}`);
  console.log(`  Posts:    ${postIds.length}`);
  console.log(`  Likes:    ${likeCount}`);
  console.log(`  Comments: ${commentCount}`);
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
