import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const MAX_BODY_BYTES = 1_000_000;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function nowIso() {
  return new Date().toISOString();
}

function defaultDb() {
  return {
    interests: [
      "Arc Browser",
      "Baseball",
      "Ben Rector",
      "Calligraphy",
      "Cooking",
      "Crossword Puzzles",
      "Gregory Alan Isakov",
      "Mechanical Keyboards",
      "Sushi",
      "Tennessee Travel",
      "Typography",
    ],
    communities: [],
    posts: [],
    comments: [],
    postVotes: [],
    commentVotes: [],
    nextIds: {
      community: 1,
      post: 1,
      comment: 1,
    },
  };
}

function cleanText(input) {
  if (typeof input !== "string") {
    return "";
  }
  return input.replace(/\s+/g, " ").trim();
}

function normalizedInterest(input) {
  return cleanText(input).toLowerCase();
}

function communityKey(firstInterest, secondInterest) {
  const sorted = [normalizedInterest(firstInterest), normalizedInterest(secondInterest)]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return sorted.join("::");
}

function slugify(input) {
  return cleanText(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sortInterests(a, b) {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

function assertCondition(condition, message, status = 400) {
  if (!condition) {
    const error = new Error(message);
    error.statusCode = status;
    throw error;
  }
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb(), null, 2));
  }
}

function loadDb() {
  ensureDataFile();
  const raw = fs.readFileSync(DB_FILE, "utf-8");
  const parsed = JSON.parse(raw);

  if (!parsed.nextIds) {
    parsed.nextIds = { community: 1, post: 1, comment: 1 };
  }
  if (!Array.isArray(parsed.postVotes)) {
    parsed.postVotes = [];
  }
  if (!Array.isArray(parsed.commentVotes)) {
    parsed.commentVotes = [];
  }
  if (!Array.isArray(parsed.communities)) {
    parsed.communities = [];
  }
  if (!Array.isArray(parsed.posts)) {
    parsed.posts = [];
  }
  if (!Array.isArray(parsed.comments)) {
    parsed.comments = [];
  }
  if (!Array.isArray(parsed.interests)) {
    parsed.interests = [];
  }

  return parsed;
}

function saveDb() {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function ensureInterest(name) {
  const cleaned = cleanText(name);
  assertCondition(cleaned.length >= 2, "Interest must be at least 2 characters.");
  assertCondition(cleaned.length <= 48, "Interest must be 48 characters or less.");

  const existing = db.interests.find(
    (interest) => normalizedInterest(interest) === normalizedInterest(cleaned),
  );
  if (existing) {
    return existing;
  }

  db.interests.push(cleaned);
  db.interests.sort(sortInterests);
  return cleaned;
}

function ensureCommunity(firstInterest, secondInterest, description = "") {
  const first = ensureInterest(firstInterest);
  const second = ensureInterest(secondInterest);

  assertCondition(
    normalizedInterest(first) !== normalizedInterest(second),
    "Community requires two distinct interests.",
  );

  const sorted = [first, second].sort(sortInterests);
  const key = communityKey(sorted[0], sorted[1]);

  let community = db.communities.find((entry) => entry.key === key);
  if (community) {
    if (description && !community.description) {
      community.description = cleanText(description).slice(0, 200);
    }
    return community;
  }

  community = {
    id: db.nextIds.community++,
    key,
    firstInterest: sorted[0],
    secondInterest: sorted[1],
    name: `${sorted[0]} x ${sorted[1]}`,
    slug: `${slugify(sorted[0])}-x-${slugify(sorted[1])}`,
    description: cleanText(description).slice(0, 200),
    createdAt: nowIso(),
  };

  db.communities.push(community);
  return community;
}

function getCommunityById(id) {
  return db.communities.find((community) => community.id === id);
}

function getPostById(id) {
  return db.posts.find((post) => post.id === id);
}

function getCommentById(id) {
  return db.comments.find((comment) => comment.id === id);
}

function rankHot(post) {
  const ageHours = Math.max((Date.now() - new Date(post.createdAt).getTime()) / 3_600_000, 0.2);
  return (post.score - 1) / (ageHours + 2);
}

function comparePosts(sort = "hot") {
  if (sort === "new") {
    return (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }
  if (sort === "top") {
    return (a, b) => b.score - a.score || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }
  return (a, b) => rankHot(b) - rankHot(a) || b.score - a.score;
}

function annotateCommunity(community) {
  const posts = db.posts.filter((post) => post.communityId === community.id);
  const members = new Set(posts.map((post) => post.author));
  const latestPost = posts
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  return {
    ...community,
    postCount: posts.length,
    memberCount: members.size,
    latestPostAt: latestPost ? latestPost.createdAt : null,
  };
}

function annotatePost(post) {
  const community = getCommunityById(post.communityId);
  return {
    ...post,
    community,
  };
}

function annotateComment(comment) {
  return {
    ...comment,
  };
}

function listFeed({ sort = "hot", communityId = null, interest = null } = {}) {
  let posts = db.posts.slice();

  if (communityId) {
    posts = posts.filter((post) => post.communityId === communityId);
  }

  if (interest) {
    const target = normalizedInterest(interest);
    const allowedCommunityIds = new Set(
      db.communities
        .filter(
          (community) =>
            normalizedInterest(community.firstInterest) === target ||
            normalizedInterest(community.secondInterest) === target,
        )
        .map((community) => community.id),
    );
    posts = posts.filter((post) => allowedCommunityIds.has(post.communityId));
  }

  return posts.sort(comparePosts(sort)).map(annotatePost);
}

function buildCommentTree(postId) {
  const comments = db.comments
    .filter((comment) => comment.postId === postId)
    .slice()
    .sort(
      (a, b) =>
        b.score - a.score ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

  const children = new Map();
  for (const comment of comments) {
    const key = comment.parentCommentId == null ? "root" : String(comment.parentCommentId);
    if (!children.has(key)) {
      children.set(key, []);
    }
    children.get(key).push(comment);
  }

  function recurse(parentId, depth) {
    const key = parentId == null ? "root" : String(parentId);
    const entries = children.get(key) || [];
    return entries.map((entry) => ({
      ...annotateComment(entry),
      depth,
      replies: recurse(entry.id, depth + 1),
    }));
  }

  return recurse(null, 0);
}

function createPost({ title, body, author, firstInterest, secondInterest, voterId }) {
  const cleanedTitle = cleanText(title);
  const cleanedBody = cleanText(body);
  const cleanedAuthor = cleanText(author) || "Anonymous";

  assertCondition(cleanedTitle.length >= 6, "Post title must be at least 6 characters.");
  assertCondition(cleanedTitle.length <= 160, "Post title must be 160 characters or less.");
  assertCondition(cleanedBody.length >= 8, "Post body must be at least 8 characters.");
  assertCondition(cleanedBody.length <= 5000, "Post body must be 5000 characters or less.");

  const community = ensureCommunity(firstInterest, secondInterest);
  const post = {
    id: db.nextIds.post++,
    communityId: community.id,
    title: cleanedTitle,
    body: cleanedBody,
    author: cleanedAuthor,
    createdAt: nowIso(),
    score: 1,
    commentCount: 0,
  };

  db.posts.push(post);
  if (voterId) {
    db.postVotes.push({
      postId: post.id,
      voterId: cleanText(voterId).slice(0, 80),
      value: 1,
    });
  }

  return annotatePost(post);
}

function addComment({ postId, body, author, parentCommentId, voterId }) {
  const post = getPostById(postId);
  assertCondition(post, "Post not found.", 404);

  const cleanedBody = cleanText(body);
  const cleanedAuthor = cleanText(author) || "Anonymous";

  assertCondition(cleanedBody.length >= 3, "Comment must be at least 3 characters.");
  assertCondition(cleanedBody.length <= 2000, "Comment must be 2000 characters or less.");

  if (parentCommentId != null) {
    const parentComment = getCommentById(parentCommentId);
    assertCondition(parentComment, "Parent comment not found.", 404);
    assertCondition(parentComment.postId === post.id, "Reply must stay in the same post.", 400);
  }

  const comment = {
    id: db.nextIds.comment++,
    postId: post.id,
    parentCommentId,
    body: cleanedBody,
    author: cleanedAuthor,
    createdAt: nowIso(),
    score: 1,
  };

  db.comments.push(comment);
  post.commentCount += 1;

  if (voterId) {
    db.commentVotes.push({
      commentId: comment.id,
      voterId: cleanText(voterId).slice(0, 80),
      value: 1,
    });
  }

  return annotateComment(comment);
}

function applyVote({ targetType, targetId, value, voterId }) {
  const numericValue = Number(value);
  assertCondition(numericValue === 1 || numericValue === -1, "Vote must be 1 or -1.");

  const cleanedVoterId = cleanText(voterId);
  assertCondition(cleanedVoterId.length >= 2, "A stable voter id is required.");

  if (targetType === "post") {
    const post = getPostById(targetId);
    assertCondition(post, "Post not found.", 404);

    let vote = db.postVotes.find((entry) => entry.postId === targetId && entry.voterId === cleanedVoterId);
    if (!vote) {
      vote = { postId: targetId, voterId: cleanedVoterId, value: 0 };
      db.postVotes.push(vote);
    }

    const delta = numericValue - vote.value;
    vote.value = numericValue;
    post.score += delta;

    return annotatePost(post);
  }

  if (targetType === "comment") {
    const comment = getCommentById(targetId);
    assertCondition(comment, "Comment not found.", 404);

    let vote = db.commentVotes.find(
      (entry) => entry.commentId === targetId && entry.voterId === cleanedVoterId,
    );
    if (!vote) {
      vote = { commentId: targetId, voterId: cleanedVoterId, value: 0 };
      db.commentVotes.push(vote);
    }

    const delta = numericValue - vote.value;
    vote.value = numericValue;
    comment.score += delta;

    return annotateComment(comment);
  }

  assertCondition(false, "Unknown vote target.");
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error("Request body too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    const error = new Error("Invalid JSON body.");
    error.statusCode = 400;
    throw error;
  }
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  const message = statusCode >= 500 ? "Internal server error." : error.message;
  json(res, statusCode, { error: message });
}

function toIntOrNull(value) {
  if (value == null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function sendBootstrap(res) {
  const communities = db.communities
    .slice()
    .map(annotateCommunity)
    .sort(
      (a, b) =>
        b.postCount - a.postCount ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  json(res, 200, {
    interests: db.interests.slice().sort(sortInterests),
    communities,
    feed: listFeed({ sort: "hot" }).slice(0, 40),
  });
}

function seedIfNeeded() {
  if (db.posts.length > 0) {
    return;
  }

  const seedPosts = [
    {
      title: "Type-inspired keycaps: serif legends or sans legends?",
      body: "I am prototyping a board inspired by old book typography. Should the alpha legends feel like Garamond or stay neutral?",
      author: "TypeSwitch",
      firstInterest: "Mechanical Keyboards",
      secondInterest: "Typography",
      ageHours: 7,
      score: 18,
    },
    {
      title: "Ben Rector + tomato pasta pairing actually works",
      body: "Tried cooking a bright tomato pasta while looping Ben Rector and it changed how sweet and fresh the dish felt. Anyone else experimenting with sonic seasoning?",
      author: "NashvilleNoodle",
      firstInterest: "Ben Rector",
      secondInterest: "Cooking",
      ageHours: 16,
      score: 23,
    },
    {
      title: "Sushi map for MLB road trips",
      body: "Building a stadium-by-stadium sushi list. Drop your favorite omakase or quick hand-roll spots within 20 minutes of any ballpark.",
      author: "SplitFingerToro",
      firstInterest: "Baseball",
      secondInterest: "Sushi",
      ageHours: 29,
      score: 31,
    },
    {
      title: "Arc browser setup for cryptic crossword sessions",
      body: "Created spaces for clue references, wordlist tabs, and clue-checking notes. Happy to share my sidebar layout if others are solving daily puzzles.",
      author: "ClueHopper",
      firstInterest: "Arc Browser",
      secondInterest: "Crossword Puzzles",
      ageHours: 4,
      score: 11,
    },
  ];

  for (const entry of seedPosts) {
    const post = createPost({
      ...entry,
      voterId: `seed-${entry.author}`,
    });
    const timestamp = new Date(Date.now() - entry.ageHours * 3_600_000).toISOString();
    const rawPost = getPostById(post.id);
    rawPost.score = entry.score;
    rawPost.createdAt = timestamp;
  }

  const firstPost = db.posts[0];
  const secondPost = db.posts[1];

  const topLevelReply = addComment({
    postId: firstPost.id,
    body: "Serif legends for alpha keys and geometric sans for modifiers gives the best contrast.",
    author: "GlyphPilot",
    parentCommentId: null,
    voterId: "seed-glyphpilot",
  });
  addComment({
    postId: firstPost.id,
    body: "I tried this with custom dye-sub and it looks incredible in warm light.",
    author: "WarmDesk",
    parentCommentId: topLevelReply.id,
    voterId: "seed-warmdesk",
  });

  addComment({
    postId: secondPost.id,
    body: "Tempo around 96 BPM made me eat slower and notice acidity more.",
    author: "TasteTempo",
    parentCommentId: null,
    voterId: "seed-tastetempo",
  });

  saveDb();
}

let db = loadDb();
seedIfNeeded();

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method || "GET";
  const segments = pathname.split("/").filter(Boolean);

  if (method === "GET" && pathname === "/api/health") {
    return json(res, 200, { ok: true, now: nowIso() });
  }

  if (method === "GET" && pathname === "/api/bootstrap") {
    return sendBootstrap(res);
  }

  if (method === "GET" && pathname === "/api/interests") {
    const counts = new Map();
    for (const community of db.communities) {
      const firstKey = normalizedInterest(community.firstInterest);
      const secondKey = normalizedInterest(community.secondInterest);
      counts.set(firstKey, (counts.get(firstKey) || 0) + 1);
      counts.set(secondKey, (counts.get(secondKey) || 0) + 1);
    }

    const interests = db.interests
      .slice()
      .sort(sortInterests)
      .map((name) => ({
        name,
        communityCount: counts.get(normalizedInterest(name)) || 0,
      }));

    return json(res, 200, { interests });
  }

  if (method === "POST" && pathname === "/api/interests") {
    const body = await readJsonBody(req);
    const interest = ensureInterest(body.name);
    saveDb();
    return json(res, 201, { interest });
  }

  if (method === "GET" && pathname === "/api/communities") {
    const filter = cleanText(url.searchParams.get("interest") || "");
    const target = normalizedInterest(filter);

    let communities = db.communities.slice().map(annotateCommunity);
    if (target) {
      communities = communities.filter(
        (community) =>
          normalizedInterest(community.firstInterest) === target ||
          normalizedInterest(community.secondInterest) === target,
      );
    }

    communities.sort(
      (a, b) =>
        b.postCount - a.postCount ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return json(res, 200, { communities });
  }

  if (method === "POST" && pathname === "/api/communities") {
    const body = await readJsonBody(req);
    const community = ensureCommunity(body.firstInterest, body.secondInterest, body.description || "");
    saveDb();
    return json(res, 201, { community: annotateCommunity(community) });
  }

  if (method === "GET" && pathname === "/api/feed") {
    const sort = cleanText(url.searchParams.get("sort") || "hot").toLowerCase();
    const interest = cleanText(url.searchParams.get("interest") || "");
    const communityId = toIntOrNull(url.searchParams.get("communityId"));

    const feed = listFeed({ sort, interest, communityId }).slice(0, 120);
    return json(res, 200, { feed });
  }

  if (method === "POST" && pathname === "/api/posts") {
    const body = await readJsonBody(req);
    const post = createPost({
      title: body.title,
      body: body.body,
      author: body.author,
      firstInterest: body.firstInterest,
      secondInterest: body.secondInterest,
      voterId: body.voterId,
    });
    saveDb();
    return json(res, 201, { post });
  }

  if (method === "GET" && segments.length === 4 && segments[0] === "api" && segments[1] === "communities" && segments[3] === "posts") {
    const communityId = Number(segments[2]);
    assertCondition(Number.isInteger(communityId), "Invalid community id.");
    const community = getCommunityById(communityId);
    assertCondition(community, "Community not found.", 404);

    const sort = cleanText(url.searchParams.get("sort") || "hot").toLowerCase();
    const posts = listFeed({ sort, communityId }).slice(0, 120);
    return json(res, 200, { posts, community: annotateCommunity(community) });
  }

  if (method === "POST" && segments.length === 4 && segments[0] === "api" && segments[1] === "posts" && segments[3] === "vote") {
    const postId = Number(segments[2]);
    assertCondition(Number.isInteger(postId), "Invalid post id.");

    const body = await readJsonBody(req);
    const post = applyVote({
      targetType: "post",
      targetId: postId,
      value: body.value,
      voterId: body.voterId,
    });

    saveDb();
    return json(res, 200, { post });
  }

  if (method === "GET" && segments.length === 4 && segments[0] === "api" && segments[1] === "posts" && segments[3] === "comments") {
    const postId = Number(segments[2]);
    assertCondition(Number.isInteger(postId), "Invalid post id.");
    const post = getPostById(postId);
    assertCondition(post, "Post not found.", 404);

    return json(res, 200, { comments: buildCommentTree(postId) });
  }

  if (method === "POST" && segments.length === 4 && segments[0] === "api" && segments[1] === "posts" && segments[3] === "comments") {
    const postId = Number(segments[2]);
    assertCondition(Number.isInteger(postId), "Invalid post id.");

    const body = await readJsonBody(req);
    const comment = addComment({
      postId,
      body: body.body,
      author: body.author,
      parentCommentId: toIntOrNull(body.parentCommentId),
      voterId: body.voterId,
    });

    saveDb();
    return json(res, 201, { comment });
  }

  if (method === "POST" && segments.length === 4 && segments[0] === "api" && segments[1] === "comments" && segments[3] === "vote") {
    const commentId = Number(segments[2]);
    assertCondition(Number.isInteger(commentId), "Invalid comment id.");

    const body = await readJsonBody(req);
    const comment = applyVote({
      targetType: "comment",
      targetId: commentId,
      value: body.value,
      voterId: body.voterId,
    });

    saveDb();
    return json(res, 200, { comment });
  }

  throw Object.assign(new Error("Not found"), { statusCode: 404 });
}

function tryReadFile(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function serveStatic(req, res, urlPath) {
  const requested = decodeURIComponent(urlPath.split("?")[0]);
  const targetPath = requested === "/" ? "/index.html" : requested;
  const resolvedPath = path.join(PUBLIC_DIR, targetPath);

  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  const fileBuffer = tryReadFile(resolvedPath);
  if (fileBuffer) {
    const extension = path.extname(resolvedPath).toLowerCase();
    res.writeHead(200, {
      "content-type": contentTypes[extension] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(fileBuffer);
    return;
  }

  const fallback = tryReadFile(path.join(PUBLIC_DIR, "index.html"));
  if (!fallback) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(fallback);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(req, res, url.pathname);
  } catch (error) {
    sendError(res, error);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Crosspassion running at http://${HOST}:${PORT}`);
});
