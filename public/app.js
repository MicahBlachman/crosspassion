const STORAGE_KEY = "crosspassion-user";

const state = {
  me: {
    id: "",
    name: "",
    interests: [],
  },
  interests: [],
  communities: [],
  activeCommunityId: null,
  activeSort: "hot",
  commentsByPost: new Map(),
};

const elements = {
  profileForm: document.querySelector("#profileForm"),
  displayName: document.querySelector("#displayName"),
  interestForm: document.querySelector("#interestForm"),
  interestInput: document.querySelector("#interestInput"),
  myInterests: document.querySelector("#myInterests"),
  communityList: document.querySelector("#communityList"),
  suggestionList: document.querySelector("#suggestionList"),
  postForm: document.querySelector("#postForm"),
  postTitle: document.querySelector("#postTitle"),
  postBody: document.querySelector("#postBody"),
  firstInterest: document.querySelector("#firstInterest"),
  secondInterest: document.querySelector("#secondInterest"),
  feedHeader: document.querySelector("#feedHeader"),
  feed: document.querySelector("#feed"),
  postTemplate: document.querySelector("#postTemplate"),
  sortTabs: document.querySelectorAll(".tab[data-sort]"),
};

function makeId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `user-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

function normalizeInterest(text) {
  return text.trim().toLowerCase();
}

function pairKey(first, second) {
  return [normalizeInterest(first), normalizeInterest(second)].sort().join("::");
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shortTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

function saveMe() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.me));
}

function loadMe() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        state.me = {
          id: typeof parsed.id === "string" && parsed.id ? parsed.id : makeId(),
          name: typeof parsed.name === "string" && parsed.name ? parsed.name : "Explorer",
          interests: Array.isArray(parsed.interests)
            ? parsed.interests.filter((item) => typeof item === "string")
            : [],
        };
        saveMe();
        return;
      }
    } catch {
      // Fall through to default.
    }
  }

  state.me = {
    id: makeId(),
    name: "Explorer",
    interests: ["Mechanical Keyboards", "Typography"],
  };
  saveMe();
}

async function api(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(options.headers || {}),
  };

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

function setSort(sort) {
  state.activeSort = sort;
  for (const tab of elements.sortTabs) {
    tab.classList.toggle("active", tab.dataset.sort === sort);
  }
}

function renderMyInterests() {
  if (state.me.interests.length === 0) {
    elements.myInterests.innerHTML = '<p class="notice">Add interests to unlock intersection suggestions.</p>';
    return;
  }

  const html = state.me.interests
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map(
      (interest) =>
        `<span class="chip">${escapeHtml(interest)} <button type="button" data-remove-interest="${escapeHtml(
          interest,
        )}" aria-label="Remove">x</button></span>`,
    )
    .join("");

  elements.myInterests.innerHTML = html;
}

function renderInterestSelects() {
  const all = state.interests.slice().sort((a, b) => a.localeCompare(b));
  const options = all.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");

  elements.firstInterest.innerHTML = options;
  elements.secondInterest.innerHTML = options;

  if (state.me.interests[0]) {
    elements.firstInterest.value = state.me.interests[0];
  }
  if (state.me.interests[1]) {
    elements.secondInterest.value = state.me.interests[1];
  }
}

function renderCommunities() {
  if (state.communities.length === 0) {
    elements.communityList.innerHTML = '<p class="notice">No communities yet. Create the first intersection with a post.</p>';
    return;
  }

  const allButton = `
    <button class="community-item ${state.activeCommunityId == null ? "active" : ""}" data-community-id="all">
      <p class="title">All intersections</p>
      <p class="meta">Global feed</p>
    </button>
  `;

  const items = state.communities
    .map((community) => {
      const isActive = state.activeCommunityId === community.id;
      return `
      <button class="community-item ${isActive ? "active" : ""}" data-community-id="${community.id}">
        <p class="title">${escapeHtml(community.name)}</p>
        <p class="meta">${community.postCount} posts - ${community.memberCount} creators</p>
      </button>
    `;
    })
    .join("");

  elements.communityList.innerHTML = allButton + items;
}

function renderFeedHeader(community) {
  if (!community) {
    elements.feedHeader.textContent = `Showing ${state.activeSort.toUpperCase()} feed across all intersections.`;
    return;
  }

  elements.feedHeader.textContent = `Showing ${state.activeSort.toUpperCase()} in ${community.name}.`;
}

function renderCommentNode(comment, postId) {
  const replies = Array.isArray(comment.replies) ? comment.replies.map((child) => renderCommentNode(child, postId)).join("") : "";
  return `
    <article class="comment" style="--depth:${comment.depth};">
      <div class="comment-meta">
        <strong>${escapeHtml(comment.author)}</strong>
        <span>${shortTime(comment.createdAt)}</span>
      </div>
      <p class="comment-body">${escapeHtml(comment.body)}</p>
      <div class="comment-actions">
        <span class="score">${comment.score}</span>
        <button class="icon-btn" data-vote-comment="up" data-comment-id="${comment.id}" data-post-id="${postId}" title="Upvote">^</button>
        <button class="icon-btn" data-vote-comment="down" data-comment-id="${comment.id}" data-post-id="${postId}" title="Downvote">v</button>
        <button class="link-btn" data-reply-comment data-post-id="${postId}" data-comment-id="${comment.id}" data-author="${escapeHtml(comment.author)}">Reply</button>
      </div>
      ${replies}
    </article>
  `;
}

function renderPost(post) {
  const node = elements.postTemplate.content.firstElementChild.cloneNode(true);

  node.dataset.postId = String(post.id);
  node.querySelector("[data-open-community]").textContent = post.community.name;
  node.querySelector("[data-open-community]").dataset.communityId = String(post.community.id);
  node.querySelector("[data-age]").textContent = `${shortTime(post.createdAt)} by ${post.author}`;
  node.querySelector("[data-title]").textContent = post.title;
  node.querySelector("[data-body]").textContent = post.body;
  node.querySelector("[data-score]").textContent = String(post.score);

  node.querySelector("[data-vote-up]").dataset.postId = String(post.id);
  node.querySelector("[data-vote-down]").dataset.postId = String(post.id);

  const toggleComments = node.querySelector("[data-toggle-comments]");
  toggleComments.dataset.postId = String(post.id);
  toggleComments.textContent = `${post.commentCount} comments`;

  const commentsWrap = node.querySelector("[data-comments-wrap]");
  const comments = state.commentsByPost.get(post.id);
  if (comments) {
    commentsWrap.classList.remove("hidden");
    renderCommentsForPost(node, post.id, comments);
  }

  node.querySelector("[data-comment-form]").dataset.postId = String(post.id);

  return node;
}

function renderCommentsForPost(postCard, postId, tree) {
  const list = postCard.querySelector("[data-comment-list]");
  if (!tree || tree.length === 0) {
    list.innerHTML = '<p class="notice">No comments yet. Start the thread.</p>';
    return;
  }

  list.innerHTML = tree.map((comment) => renderCommentNode(comment, postId)).join("");
}

function renderFeed(posts) {
  elements.feed.innerHTML = "";

  if (posts.length === 0) {
    elements.feed.innerHTML = '<p class="notice">No posts here yet. Create one from the form above.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const post of posts) {
    fragment.appendChild(renderPost(post));
  }
  elements.feed.appendChild(fragment);
}

function renderSuggestions() {
  const uniqueInterests = Array.from(new Set(state.me.interests)).sort((a, b) => a.localeCompare(b));

  if (uniqueInterests.length < 2) {
    elements.suggestionList.innerHTML = '<p class="notice">Add at least two interests to build your map.</p>';
    return;
  }

  const byKey = new Map(state.communities.map((community) => [pairKey(community.firstInterest, community.secondInterest), community]));
  const combinations = [];

  for (let i = 0; i < uniqueInterests.length; i += 1) {
    for (let j = i + 1; j < uniqueInterests.length; j += 1) {
      const first = uniqueInterests[i];
      const second = uniqueInterests[j];
      const key = pairKey(first, second);
      const existing = byKey.get(key);
      combinations.push({
        first,
        second,
        key,
        existing,
      });
    }
  }

  combinations.sort((a, b) => {
    if (a.existing && !b.existing) return -1;
    if (!a.existing && b.existing) return 1;
    if (a.existing && b.existing) return b.existing.postCount - a.existing.postCount;
    return `${a.first} ${a.second}`.localeCompare(`${b.first} ${b.second}`);
  });

  elements.suggestionList.innerHTML = combinations
    .slice(0, 16)
    .map((combo) => {
      if (combo.existing) {
        return `
          <article class="suggestion-item">
            <strong>${escapeHtml(combo.existing.name)}</strong>
            <p class="meta">${combo.existing.postCount} posts</p>
            <button class="btn" data-open-community-id="${combo.existing.id}">Open community</button>
          </article>
        `;
      }

      return `
        <article class="suggestion-item">
          <strong>${escapeHtml(combo.first)} x ${escapeHtml(combo.second)}</strong>
          <p class="meta">No community yet</p>
          <button class="btn" data-create-community="${escapeHtml(combo.first)}||${escapeHtml(combo.second)}">Create intersection</button>
        </article>
      `;
    })
    .join("");
}

async function refreshBootstrap() {
  const payload = await api("/api/bootstrap", { method: "GET" });
  state.interests = payload.interests || [];
  state.communities = payload.communities || [];

  const activeStillExists =
    state.activeCommunityId == null || state.communities.some((community) => community.id === state.activeCommunityId);
  if (!activeStillExists) {
    state.activeCommunityId = null;
  }

  renderInterestSelects();
  renderCommunities();
  renderSuggestions();
}

async function loadFeed() {
  const params = new URLSearchParams({ sort: state.activeSort });
  let endpoint = "/api/feed";

  if (state.activeCommunityId != null) {
    endpoint = `/api/communities/${state.activeCommunityId}/posts`;
  }

  const payload = await api(`${endpoint}?${params.toString()}`, { method: "GET" });
  const posts = payload.feed || payload.posts || [];
  const activeCommunity = state.activeCommunityId == null
    ? null
    : state.communities.find((community) => community.id === state.activeCommunityId) || null;

  renderFeedHeader(activeCommunity);
  renderFeed(posts);
}

async function boot() {
  loadMe();
  elements.displayName.value = state.me.name;
  renderMyInterests();

  await refreshBootstrap();
  await loadFeed();
}

elements.profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = elements.displayName.value.trim();
  if (!name) {
    alert("Name cannot be empty.");
    return;
  }

  state.me.name = name.slice(0, 40);
  saveMe();
});

elements.interestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = elements.interestInput.value.trim();
  if (!name) {
    return;
  }

  try {
    const payload = await api("/api/interests", {
      method: "POST",
      body: JSON.stringify({ name }),
    });

    const created = payload.interest;
    if (!state.me.interests.some((interest) => normalizeInterest(interest) === normalizeInterest(created))) {
      state.me.interests.push(created);
      saveMe();
      renderMyInterests();
    }

    elements.interestInput.value = "";
    await refreshBootstrap();
  } catch (error) {
    alert(error.message);
  }
});

elements.postForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const title = elements.postTitle.value.trim();
  const body = elements.postBody.value.trim();
  const firstInterest = elements.firstInterest.value;
  const secondInterest = elements.secondInterest.value;

  if (!title || !body || !firstInterest || !secondInterest) {
    alert("Please complete all post fields.");
    return;
  }

  if (normalizeInterest(firstInterest) === normalizeInterest(secondInterest)) {
    alert("Choose two different interests for the intersection community.");
    return;
  }

  try {
    await api("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        title,
        body,
        firstInterest,
        secondInterest,
        author: state.me.name,
        voterId: state.me.id,
      }),
    });

    elements.postTitle.value = "";
    elements.postBody.value = "";

    await refreshBootstrap();
    await loadFeed();
  } catch (error) {
    alert(error.message);
  }
});

for (const tab of elements.sortTabs) {
  tab.addEventListener("click", async () => {
    setSort(tab.dataset.sort);
    await loadFeed();
  });
}

function postCardFromChild(node) {
  return node.closest(".post-card");
}

async function openComments(postCard, postId) {
  const commentsWrap = postCard.querySelector("[data-comments-wrap]");
  const isOpen = !commentsWrap.classList.contains("hidden");
  if (isOpen) {
    commentsWrap.classList.add("hidden");
    return;
  }

  if (!state.commentsByPost.has(postId)) {
    const payload = await api(`/api/posts/${postId}/comments`, { method: "GET" });
    state.commentsByPost.set(postId, payload.comments || []);
  }

  commentsWrap.classList.remove("hidden");
  renderCommentsForPost(postCard, postId, state.commentsByPost.get(postId));
}

async function votePost(postId, value) {
  await api(`/api/posts/${postId}/vote`, {
    method: "POST",
    body: JSON.stringify({ value, voterId: state.me.id }),
  });
  await refreshBootstrap();
  await loadFeed();
}

async function voteComment(postId, commentId, value) {
  await api(`/api/comments/${commentId}/vote`, {
    method: "POST",
    body: JSON.stringify({ value, voterId: state.me.id }),
  });

  const payload = await api(`/api/posts/${postId}/comments`, { method: "GET" });
  state.commentsByPost.set(postId, payload.comments || []);
  await loadFeed();
}

function setReplyTarget(postCard, commentId, author) {
  const form = postCard.querySelector("[data-comment-form]");
  const hiddenInput = form.querySelector('input[name="parentCommentId"]');
  const banner = form.querySelector("[data-reply-banner]");
  const cancelButton = form.querySelector("[data-cancel-reply]");

  hiddenInput.value = String(commentId);
  banner.textContent = `Replying to ${author}`;
  banner.classList.remove("hidden");
  cancelButton.classList.remove("hidden");
}

function clearReplyTarget(postCard) {
  const form = postCard.querySelector("[data-comment-form]");
  const hiddenInput = form.querySelector('input[name="parentCommentId"]');
  const banner = form.querySelector("[data-reply-banner]");
  const cancelButton = form.querySelector("[data-cancel-reply]");

  hiddenInput.value = "";
  banner.textContent = "";
  banner.classList.add("hidden");
  cancelButton.classList.add("hidden");
}

async function submitComment(form) {
  const postId = Number(form.dataset.postId);
  const formData = new FormData(form);
  const body = String(formData.get("body") || "").trim();
  const parentCommentId = String(formData.get("parentCommentId") || "").trim();

  if (!body) {
    return;
  }

  await api(`/api/posts/${postId}/comments`, {
    method: "POST",
    body: JSON.stringify({
      body,
      author: state.me.name,
      parentCommentId: parentCommentId || null,
      voterId: state.me.id,
    }),
  });

  const payload = await api(`/api/posts/${postId}/comments`, { method: "GET" });
  state.commentsByPost.set(postId, payload.comments || []);

  form.reset();
  const postCard = form.closest(".post-card");
  clearReplyTarget(postCard);

  await refreshBootstrap();
  await loadFeed();
}

window.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const removeInterest = target.closest("[data-remove-interest]");
  if (removeInterest) {
    const interest = removeInterest.dataset.removeInterest;
    state.me.interests = state.me.interests.filter((item) => normalizeInterest(item) !== normalizeInterest(interest));
    saveMe();
    renderMyInterests();
    renderSuggestions();
    return;
  }

  const communityButton = target.closest("[data-community-id]");
  if (communityButton) {
    const value = communityButton.dataset.communityId;
    state.activeCommunityId = value === "all" ? null : Number(value);
    renderCommunities();
    await loadFeed();
    return;
  }

  const openCommunity = target.closest("[data-open-community-id]");
  if (openCommunity) {
    state.activeCommunityId = Number(openCommunity.dataset.openCommunityId);
    renderCommunities();
    await loadFeed();
    return;
  }

  const createCommunity = target.closest("[data-create-community]");
  if (createCommunity) {
    const [first, second] = createCommunity.dataset.createCommunity.split("||");
    try {
      await api("/api/communities", {
        method: "POST",
        body: JSON.stringify({ firstInterest: first, secondInterest: second }),
      });
      await refreshBootstrap();
      await loadFeed();
    } catch (error) {
      alert(error.message);
    }
    return;
  }

  const openCommunityFromPost = target.closest("[data-open-community]");
  if (openCommunityFromPost) {
    state.activeCommunityId = Number(openCommunityFromPost.dataset.communityId);
    renderCommunities();
    await loadFeed();
    return;
  }

  const upvotePost = target.closest("[data-vote-up]");
  if (upvotePost) {
    await votePost(Number(upvotePost.dataset.postId), 1);
    return;
  }

  const downvotePost = target.closest("[data-vote-down]");
  if (downvotePost) {
    await votePost(Number(downvotePost.dataset.postId), -1);
    return;
  }

  const toggleComments = target.closest("[data-toggle-comments]");
  if (toggleComments) {
    const postId = Number(toggleComments.dataset.postId);
    const postCard = postCardFromChild(toggleComments);
    await openComments(postCard, postId);
    return;
  }

  const upvoteComment = target.closest('[data-vote-comment="up"]');
  if (upvoteComment) {
    await voteComment(Number(upvoteComment.dataset.postId), Number(upvoteComment.dataset.commentId), 1);
    return;
  }

  const downvoteComment = target.closest('[data-vote-comment="down"]');
  if (downvoteComment) {
    await voteComment(Number(downvoteComment.dataset.postId), Number(downvoteComment.dataset.commentId), -1);
    return;
  }

  const replyComment = target.closest("[data-reply-comment]");
  if (replyComment) {
    const postCard = postCardFromChild(replyComment);
    setReplyTarget(postCard, Number(replyComment.dataset.commentId), replyComment.dataset.author || "user");
    return;
  }

  const cancelReply = target.closest("[data-cancel-reply]");
  if (cancelReply) {
    const postCard = postCardFromChild(cancelReply);
    clearReplyTarget(postCard);
  }
});

window.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-comment-form]");
  if (!form) {
    return;
  }
  event.preventDefault();

  try {
    await submitComment(form);
  } catch (error) {
    alert(error.message);
  }
});

boot().catch((error) => {
  elements.feed.innerHTML = `<p class="notice error">Failed to load app: ${escapeHtml(error.message)}</p>`;
});
