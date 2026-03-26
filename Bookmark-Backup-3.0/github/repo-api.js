const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const githubRepoWriteQueues = new Map();

function buildGitHubAuthHeader(token) {
  const trimmedToken = (token || '').trim();
  if (!trimmedToken) return null;
  return `Bearer ${trimmedToken}`;
}

function normalizeGitHubError(error) {
  if (!error) return '未知错误';

  const detail = String(error.message || '').trim();
  const withDetail = (baseText) => {
    if (!detail || detail === baseText || baseText.includes(detail)) {
      return baseText;
    }
    return `${baseText}: ${detail}`;
  };

  const status = Number(error.status);
  if (status === 401) return withDetail('GitHub Token 无效或无权限（401）');
  if (status === 403) return withDetail('GitHub 拒绝访问或触发速率限制（403）');
  if (status === 404) {
    const detailText = `${detail} ${JSON.stringify(error?.response || {})}`.toLowerCase();
    if (
      detailText.includes('no commit found for the ref')
      || detailText.includes('branch not found')
      || detailText.includes('ref not found')
      || detailText.includes('reference does not exist')
    ) {
      return withDetail('分支不存在或尚未就绪（404）');
    }
    return withDetail('仓库不存在或无权限（404）');
  }
  if (status === 409) return withDetail('分支不存在或发生冲突（409）');
  if (status === 413) return withDetail('文件过大（413）');
  if (status === 422) return withDetail('请求校验失败（422）');

  return detail || '未知错误';
}

function extractGitHubErrorText(error) {
  const parts = [];
  const push = (value) => {
    const text = String(value || '').trim();
    if (!text) return;
    if (!parts.includes(text)) {
      parts.push(text);
    }
  };

  push(error?.message);

  const response = error?.response;
  if (typeof response === 'string') {
    push(response);
  } else if (response && typeof response === 'object') {
    push(response.message);
    if (Array.isArray(response.errors)) {
      response.errors.forEach((item) => {
        if (!item) return;
        if (typeof item === 'string') {
          push(item);
          return;
        }
        push(item.message);
        push(item.code);
      });
    }
  }

  return parts.join(' | ');
}

function extractGitHubExpectedShaFromConflict(error) {
  const haystack = [
    String(error?.message || ''),
    extractGitHubErrorText(error)
  ]
    .filter(Boolean)
    .join(' | ');

  if (!haystack) return null;

  // Common GitHub conflict text:
  // "<path> does not match <40-hex-sha>"
  let match = haystack.match(/does\s+not\s+match\s+([0-9a-f]{40})/i);
  if (match && match[1]) {
    return String(match[1]).toLowerCase();
  }

  // Fallback patterns seen in API / proxy layers.
  match = haystack.match(/expected(?:\s+sha)?[:=\s]+([0-9a-f]{40})/i);
  if (match && match[1]) {
    return String(match[1]).toLowerCase();
  }

  match = haystack.match(/\bsha\b[^0-9a-f]{0,16}([0-9a-f]{40})/i);
  if (match && match[1]) {
    return String(match[1]).toLowerCase();
  }

  return null;
}

function isGitHubBranchWarmupError(error) {
  const status = Number(error?.status);
  if (status !== 404 && status !== 409 && status !== 422) return false;

  const detailText = extractGitHubErrorText(error).toLowerCase();
  if (!detailText) return status === 404;

  return detailText.includes('no commit found for the ref')
    || detailText.includes('branch not found')
    || detailText.includes('ref not found')
    || detailText.includes('reference does not exist')
    || detailText.includes('not found');
}

function encodeGitHubPath(path) {
  return String(path || '')
    .split('/')
    .filter((s) => s.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildGitHubWriteQueueKey({ owner, repo, branch }) {
  const normalizedOwner = String(owner || '').trim().toLowerCase();
  const normalizedRepo = String(repo || '').trim().toLowerCase();
  const normalizedBranch = String(branch || '').trim().toLowerCase() || '__default__';
  return `${normalizedOwner}/${normalizedRepo}@${normalizedBranch}`;
}

function enqueueGitHubRepoWrite(queueKey, taskFactory) {
  const previous = githubRepoWriteQueues.get(queueKey) || Promise.resolve();
  const run = previous
    .catch(() => {})
    .then(() => taskFactory());
  const tracked = run.finally(() => {
    if (githubRepoWriteQueues.get(queueKey) === tracked) {
      githubRepoWriteQueues.delete(queueKey);
    }
  });
  githubRepoWriteQueues.set(queueKey, tracked);
  return run;
}

function splitGitHubPathParts(path) {
  const parts = String(path || '')
    .split('/')
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  const fileName = parts.length > 0 ? parts[parts.length - 1] : '';
  const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
  return { fileName, parentPath };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function buildGitHubRepoApiBase(owner, repo) {
  return `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function buildGitHubRepoBlobHtmlUrl(owner, repo, branch, path) {
  const normalizedPath = String(path || '')
    .split('/')
    .filter((segment) => String(segment || '').length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  if (!normalizedPath) return null;
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodeURIComponent(branch)}/${normalizedPath}`;
}

function isGitHubReferenceAlreadyExistsError(error) {
  const status = Number(error?.status);
  if (status !== 422) return false;

  const message = String(error?.message || '').toLowerCase();
  const response = error?.response;
  const responseText = typeof response === 'string'
    ? response.toLowerCase()
    : JSON.stringify(response || {}).toLowerCase();
  return `${message} ${responseText}`.includes('reference already exists');
}

async function waitForGitHubBranchReady({ repoApiBase, authHeader, branchName, maxAttempts = 5, baseDelayMs = 180, settleDelayMs = 120 } = {}) {
  const safeRepoApiBase = String(repoApiBase || '').trim();
  const safeAuthHeader = String(authHeader || '').trim();
  const safeBranchName = String(branchName || '').trim();
  if (!safeRepoApiBase || !safeAuthHeader || !safeBranchName) {
    return true;
  }

  for (let attempt = 0; attempt < Math.max(1, Number(maxAttempts) || 0); attempt++) {
    try {
      await githubRequestJson(
        `${safeRepoApiBase}/git/ref/heads/${encodeURIComponent(safeBranchName)}`,
        { headers: { Authorization: safeAuthHeader } }
      );
      if (settleDelayMs > 0) {
        await delay(settleDelayMs);
      }
      return true;
    } catch (error) {
      if (Number(error?.status) !== 404) {
        throw error;
      }
      if (attempt >= Math.max(1, Number(maxAttempts) || 0) - 1) {
        return false;
      }
      await delay((attempt + 1) * Math.max(60, Number(baseDelayMs) || 0));
    }
  }

  return false;
}

async function githubRequestJson(url, { method = 'GET', headers = {}, body, _retryCount = 0 } = {}) {
  const MAX_RETRIES = 2;

  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      ...headers
    },
    body
  });

  // Rate limit / server error retry (429, 403 with rate limit, 5xx)
  const status = response.status;
  const isRateLimit = status === 429
    || (status === 403 && (response.headers.get('X-RateLimit-Remaining') === '0'));
  const isServerError = status >= 500 && status < 600;

  if ((isRateLimit || isServerError) && _retryCount < MAX_RETRIES) {
    let waitMs = (1 << _retryCount) * 1000; // exponential: 1s, 2s
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) {
      const parsed = Number(retryAfter);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 60) {
        waitMs = parsed * 1000;
      }
    }
    await new Promise(resolve => setTimeout(resolve, waitMs));
    return githubRequestJson(url, { method, headers, body, _retryCount: _retryCount + 1 });
  }

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = null;
  }

  if (!response.ok) {
    const error = new Error(
      (json && typeof json.message === 'string' && json.message) ||
        `${status} ${response.statusText}`.trim()
    );
    error.status = status;
    error.response = json || text;
    throw error;
  }

  return json;
}

export async function getRepoInfo({ token, owner, repo }) {
  const authHeader = buildGitHubAuthHeader(token);
  if (!authHeader) {
    return { success: false, error: 'GitHub Token 未配置' };
  }

  const trimmedOwner = String(owner || '').trim();
  const trimmedRepo = String(repo || '').trim();
  if (!trimmedOwner || !trimmedRepo) {
    return { success: false, error: '仓库未配置' };
  }

  try {
    const json = await githubRequestJson(
      `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}`,
      {
        headers: { Authorization: authHeader }
      }
    );

    const permissions = json && typeof json.permissions === 'object' && json.permissions ? json.permissions : null;

    return {
      success: true,
      repo: {
        id: json && json.id ? String(json.id) : null,
        fullName: json && json.full_name ? String(json.full_name) : `${trimmedOwner}/${trimmedRepo}`,
        defaultBranch: json && json.default_branch ? String(json.default_branch) : null,
        private: json && json.private === true,
        htmlUrl: json && json.html_url ? String(json.html_url) : null,
        permissions: permissions
          ? {
              pull: permissions.pull === true,
              push: permissions.push === true,
              admin: permissions.admin === true
            }
          : null
      }
    };
  } catch (error) {
    return { success: false, error: normalizeGitHubError(error) };
  }
}

export async function testRepoConnection({ token, owner, repo, branch, basePath }) {
  const authHeader = buildGitHubAuthHeader(token);
  if (!authHeader) {
    return { success: false, error: 'GitHub Token 未配置' };
  }

  const trimmedOwner = String(owner || '').trim();
  const trimmedRepo = String(repo || '').trim();
  if (!trimmedOwner || !trimmedRepo) {
    return { success: false, error: '仓库未配置' };
  }

  try {
    const repoApiBase = buildGitHubRepoApiBase(trimmedOwner, trimmedRepo);
    const repoInfo = await githubRequestJson(
      repoApiBase,
      {
        headers: { Authorization: authHeader }
      }
    );

    const defaultBranch =
      repoInfo && typeof repoInfo.default_branch === 'string' ? repoInfo.default_branch : null;
    const resolvedBranch = (branch || '').trim() || defaultBranch || null;

    let branchExists = null;
    let branchWillBeCreated = false;
    if (resolvedBranch) {
      try {
        await githubRequestJson(
          `${repoApiBase}/git/ref/heads/${encodeURIComponent(resolvedBranch)}`,
          { headers: { Authorization: authHeader } }
        );
        branchExists = true;
      } catch (error) {
        if (Number(error?.status) === 404) {
          branchExists = false;
          branchWillBeCreated = true;
        } else {
          throw error;
        }
      }
    }

    let basePathExists = null;
    const trimmedBasePath = String(basePath || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (trimmedBasePath && resolvedBranch && branchExists !== false) {
      try {
        await githubRequestJson(
          `${repoApiBase}/contents/${encodeGitHubPath(trimmedBasePath)}?ref=${encodeURIComponent(resolvedBranch)}`,
          { headers: { Authorization: authHeader } }
        );
        basePathExists = true;
      } catch (error) {
        if (Number(error?.status) === 404) {
          basePathExists = false;
        } else {
          throw error;
        }
      }
    }

    const permissions =
      repoInfo && typeof repoInfo.permissions === 'object' && repoInfo.permissions ? repoInfo.permissions : null;

    return {
      success: true,
      repo: {
        id: repoInfo && repoInfo.id ? String(repoInfo.id) : null,
        fullName: repoInfo && repoInfo.full_name ? String(repoInfo.full_name) : `${trimmedOwner}/${trimmedRepo}`,
        defaultBranch,
        private: repoInfo && repoInfo.private === true,
        htmlUrl: repoInfo && repoInfo.html_url ? String(repoInfo.html_url) : null,
        permissions: permissions
          ? {
              pull: permissions.pull === true,
              push: permissions.push === true,
              admin: permissions.admin === true
            }
          : null
      },
      resolvedBranch,
      basePathExists,
      branchExists,
      branchWillBeCreated
    };
  } catch (error) {
    return { success: false, error: normalizeGitHubError(error) };
  }
}

export async function upsertRepoFile({ token, owner, repo, branch, path, message, contentBase64 }) {
  const authHeader = buildGitHubAuthHeader(token);
  if (!authHeader) {
    return { success: false, error: 'GitHub Token 未配置', repoNotConfigured: true };
  }

  const trimmedOwner = String(owner || '').trim();
  const trimmedRepo = String(repo || '').trim();
  if (!trimmedOwner || !trimmedRepo) {
    return { success: false, error: '仓库未配置', repoNotConfigured: true };
  }

  const trimmedPath = String(path || '').trim().replace(/^\/+/, '');
  if (!trimmedPath) {
    return { success: false, error: '缺少文件路径' };
  }

  const trimmedBranch = String(branch || '').trim();
  const queueKey = buildGitHubWriteQueueKey({
    owner: trimmedOwner,
    repo: trimmedRepo,
    branch: trimmedBranch
  });

  const safeMessage = String(message || '').trim() || `Bookmark Backup: ${trimmedPath}`;
  const safeContentBase64 = String(contentBase64 || '').trim();
  if (!safeContentBase64) {
    return { success: false, error: '缺少文件内容' };
  }

  return enqueueGitHubRepoWrite(queueKey, async () => {
    const encodedPath = encodeGitHubPath(trimmedPath);
    const repoApiBase = buildGitHubRepoApiBase(trimmedOwner, trimmedRepo);
    const urlBase = `${repoApiBase}/contents/${encodedPath}`;

    const createBranchRef = async (branchName, commitSha) => {
      return await githubRequestJson(
        `${repoApiBase}/git/refs`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ref: `refs/heads/${branchName}`,
            sha: commitSha
          })
        }
      );
    };

    const createInitialCommitForMissingBranch = async () => {
      const blobJson = await githubRequestJson(
        `${repoApiBase}/git/blobs`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            content: safeContentBase64,
            encoding: 'base64'
          })
        }
      );
      const blobSha = blobJson && blobJson.sha ? String(blobJson.sha) : '';
      if (!blobSha) {
        throw new Error('创建 GitHub Blob 失败');
      }

      const treeJson = await githubRequestJson(
        `${repoApiBase}/git/trees`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            tree: [
              {
                path: trimmedPath,
                mode: '100644',
                type: 'blob',
                sha: blobSha
              }
            ]
          })
        }
      );
      const treeSha = treeJson && treeJson.sha ? String(treeJson.sha) : '';
      if (!treeSha) {
        throw new Error('创建 GitHub Tree 失败');
      }

      const commitJson = await githubRequestJson(
        `${repoApiBase}/git/commits`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: safeMessage,
            tree: treeSha,
            parents: []
          })
        }
      );
      const commitSha = commitJson && commitJson.sha ? String(commitJson.sha) : '';
      if (!commitSha) {
        throw new Error('创建 GitHub Commit 失败');
      }

      return commitSha;
    };

    const ensureBranchWritable = async () => {
      if (!trimmedBranch) {
        return { branchCreated: false, branchReady: true, initialCommitCreated: false, shortCircuitResult: null };
      }

      try {
        await githubRequestJson(
          `${repoApiBase}/git/ref/heads/${encodeURIComponent(trimmedBranch)}`,
          { headers: { Authorization: authHeader } }
        );
        return { branchCreated: false, branchReady: true, initialCommitCreated: false, shortCircuitResult: null };
      } catch (error) {
        if (Number(error?.status) !== 404) {
          throw error;
        }
      }

      const repoInfo = await githubRequestJson(
        repoApiBase,
        { headers: { Authorization: authHeader } }
      );
      const defaultBranch = repoInfo && typeof repoInfo.default_branch === 'string'
        ? repoInfo.default_branch.trim()
        : '';

      if (defaultBranch && defaultBranch !== trimmedBranch) {
        try {
          const defaultRefJson = await githubRequestJson(
            `${repoApiBase}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
            { headers: { Authorization: authHeader } }
          );
          const defaultHeadSha = defaultRefJson && defaultRefJson.object && defaultRefJson.object.sha
            ? String(defaultRefJson.object.sha)
            : '';
          if (defaultHeadSha) {
            try {
              await createBranchRef(trimmedBranch, defaultHeadSha);
            } catch (createError) {
              if (!isGitHubReferenceAlreadyExistsError(createError)) {
                throw createError;
              }
            }
            const branchReady = await waitForGitHubBranchReady({
              repoApiBase,
              authHeader,
              branchName: trimmedBranch
            });
            return { branchCreated: true, branchReady, initialCommitCreated: false, shortCircuitResult: null };
          }
        } catch (defaultBranchError) {
          if (Number(defaultBranchError?.status) !== 404) {
            throw defaultBranchError;
          }
        }
      }

      const initialCommitSha = await createInitialCommitForMissingBranch();
      try {
        await createBranchRef(trimmedBranch, initialCommitSha);
      } catch (createError) {
        if (!isGitHubReferenceAlreadyExistsError(createError)) {
          throw createError;
        }
        return { branchCreated: false, branchReady: true, initialCommitCreated: false, shortCircuitResult: null };
      }

      const branchReady = await waitForGitHubBranchReady({
        repoApiBase,
        authHeader,
        branchName: trimmedBranch
      });

      return {
        branchCreated: true,
        branchReady,
        initialCommitCreated: true,
        shortCircuitResult: {
          success: true,
          created: true,
          path: trimmedPath,
          htmlUrl: buildGitHubRepoBlobHtmlUrl(trimmedOwner, trimmedRepo, trimmedBranch, trimmedPath),
          commitSha: initialCommitSha,
          branchCreated: true,
          branchReady,
          initialCommit: true
        }
      };
    };

    let branchEnsureResult = null;
    try {
      branchEnsureResult = await ensureBranchWritable();
    } catch (error) {
      return { success: false, error: normalizeGitHubError(error) };
    }
    if (branchEnsureResult?.shortCircuitResult) {
      return branchEnsureResult.shortCircuitResult;
    }

    const loadExistingShaByFile = async () => {
      const existingUrl = trimmedBranch ? `${urlBase}?ref=${encodeURIComponent(trimmedBranch)}` : urlBase;
      const existing = await githubRequestJson(existingUrl, {
        headers: { Authorization: authHeader }
      });
      if (existing && !Array.isArray(existing) && typeof existing === 'object' && existing.sha) {
        return String(existing.sha);
      }
      return null;
    };

    const loadExistingShaByParentDir = async () => {
      const { parentPath, fileName } = splitGitHubPathParts(trimmedPath);
      if (!fileName) return null;

      const encodedParentPath = encodeGitHubPath(parentPath);
      const parentUrl = encodedParentPath
        ? `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/contents/${encodedParentPath}`
        : `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/contents`;
      const parentWithRef = trimmedBranch ? `${parentUrl}?ref=${encodeURIComponent(trimmedBranch)}` : parentUrl;
      const items = await githubRequestJson(parentWithRef, {
        headers: { Authorization: authHeader }
      });
      if (!Array.isArray(items)) return null;

      const hit = items.find((item) => {
        if (!item || typeof item !== 'object') return false;
        return String(item.name || '').trim() === fileName && item.sha;
      });
      return hit && hit.sha ? String(hit.sha) : null;
    };

    const loadExistingShaByTree = async () => {
      const resolvedBranch = trimmedBranch || 'HEAD';
      const treeUrl = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/git/trees/${encodeURIComponent(resolvedBranch)}?recursive=1`;
      const treeData = await githubRequestJson(treeUrl, {
        headers: { Authorization: authHeader }
      });
      const tree = treeData && Array.isArray(treeData.tree) ? treeData.tree : [];
      const hit = tree.find((node) => node && node.type === 'blob' && String(node.path || '').trim() === trimmedPath && node.sha);
      return hit && hit.sha ? String(hit.sha) : null;
    };

    const loadExistingSha = async ({ allowTreeFallback = false, waitMs = 0 } = {}) => {
      if (waitMs > 0) {
        await delay(waitMs);
      }

      try {
        const shaByFile = await loadExistingShaByFile();
        if (shaByFile) return shaByFile;
      } catch (error) {
        if (Number(error?.status) !== 404) {
          throw error;
        }
      }

      try {
        const shaByParentDir = await loadExistingShaByParentDir();
        if (shaByParentDir) return shaByParentDir;
      } catch (error) {
        if (Number(error?.status) !== 404) {
          throw error;
        }
      }

      if (!allowTreeFallback) {
        return null;
      }

      try {
        return await loadExistingShaByTree();
      } catch (error) {
        if (Number(error?.status) === 404) {
          return null;
        }
        throw error;
      }
    };

    let existingSha = null;
    try {
      existingSha = await loadExistingSha();
    } catch (error) {
      if (Number(error?.status) !== 404) {
        return { success: false, error: normalizeGitHubError(error) };
      }
    }

    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const payload = {
        message: safeMessage,
        content: safeContentBase64
      };
      if (trimmedBranch) {
        payload.branch = trimmedBranch;
      }
      if (existingSha) {
        payload.sha = existingSha;
      }

      try {
        const json = await githubRequestJson(urlBase, {
          method: 'PUT',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const content = json && typeof json.content === 'object' && json.content ? json.content : null;
        const commit = json && typeof json.commit === 'object' && json.commit ? json.commit : null;

        return {
          success: true,
          created: !existingSha,
          path: content && content.path ? String(content.path) : trimmedPath,
          htmlUrl: content && content.html_url ? String(content.html_url) : null,
          commitSha: commit && commit.sha ? String(commit.sha) : null,
          branchCreated: branchEnsureResult?.branchCreated === true
        };
      } catch (error) {
        const status = Number(error?.status);
        const messageText = String(error?.message || '').toLowerCase();
        const shouldRetryBranchWarmup = branchEnsureResult?.branchCreated === true
          && isGitHubBranchWarmupError(error)
          && attempt < (maxAttempts - 1);
        const isShaConflict = status === 409
          || (status === 422 && (messageText.includes('sha') || messageText.includes('conflict') || messageText.includes('does not match')));

        if (shouldRetryBranchWarmup) {
          try {
            await waitForGitHubBranchReady({
              repoApiBase,
              authHeader,
              branchName: trimmedBranch,
              maxAttempts: 3,
              baseDelayMs: (attempt + 1) * 220,
              settleDelayMs: 160
            });
            existingSha = await loadExistingSha({
              allowTreeFallback: attempt > 0,
              waitMs: (attempt + 1) * 120
            });
          } catch (refreshError) {
            if (Number(refreshError?.status) === 404) {
              existingSha = null;
            } else {
              return { success: false, error: normalizeGitHubError(refreshError) };
            }
          }
          continue;
        }

        if (!isShaConflict || attempt >= (maxAttempts - 1)) {
          if (branchEnsureResult?.branchCreated === true && isGitHubBranchWarmupError(error)) {
            return { success: false, error: '新分支已创建，但 GitHub 还在同步分支信息，请稍后重试' };
          }
          return { success: false, error: normalizeGitHubError(error) };
        }

        // 优先使用冲突响应中给出的最新 sha，避免 Contents API 读到旧缓存导致循环冲突。
        const expectedShaFromConflict = extractGitHubExpectedShaFromConflict(error);
        if (expectedShaFromConflict && expectedShaFromConflict !== existingSha) {
          existingSha = expectedShaFromConflict;
          await delay((attempt + 1) * 160);
          continue;
        }

        try {
          existingSha = await loadExistingSha({
            allowTreeFallback: true,
            waitMs: (attempt + 1) * 220
          });
        } catch (refreshError) {
          if (Number(refreshError?.status) === 404) {
            existingSha = null;
          } else {
            return { success: false, error: normalizeGitHubError(refreshError) };
          }
        }
      }
    }

    return { success: false, error: 'GitHub 写入失败（未知冲突）' };
  });
}
