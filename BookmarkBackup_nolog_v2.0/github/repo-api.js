const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';

function buildGitHubAuthHeader(token) {
  const trimmedToken = (token || '').trim();
  if (!trimmedToken) return null;
  return `Bearer ${trimmedToken}`;
}

function normalizeGitHubError(error) {
  if (!error) return '未知错误';

  const status = Number(error.status);
  if (status === 401) return 'GitHub Token 无效或无权限（401）';
  if (status === 403) return 'GitHub 拒绝访问或触发速率限制（403）';
  if (status === 404) return '仓库不存在或无权限（404）';
  if (status === 409) return '分支不存在或发生冲突（409）';
  if (status === 413) return '文件过大（413）';
  if (status === 422) return '请求校验失败（422）';

  return error.message || '未知错误';
}

function encodeGitHubPath(path) {
  return String(path || '')
    .split('/')
    .filter((s) => s.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function githubRequestJson(url, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      ...headers
    },
    body
  });

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
        `${response.status} ${response.statusText}`.trim()
    );
    error.status = response.status;
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
    const repoInfo = await githubRequestJson(
      `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}`,
      {
        headers: { Authorization: authHeader }
      }
    );

    const defaultBranch =
      repoInfo && typeof repoInfo.default_branch === 'string' ? repoInfo.default_branch : null;
    const resolvedBranch = (branch || '').trim() || defaultBranch || null;

    let basePathExists = null;
    const trimmedBasePath = String(basePath || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (trimmedBasePath && resolvedBranch) {
      try {
        await githubRequestJson(
          `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/contents/${encodeGitHubPath(trimmedBasePath)}?ref=${encodeURIComponent(resolvedBranch)}`,
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
      basePathExists
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

  const safeMessage = String(message || '').trim() || `Bookmark Backup: ${trimmedPath}`;
  const safeContentBase64 = String(contentBase64 || '').trim();
  if (!safeContentBase64) {
    return { success: false, error: '缺少文件内容' };
  }

  const encodedPath = encodeGitHubPath(trimmedPath);
  const urlBase = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/contents/${encodedPath}`;

  let existingSha = null;
  try {
    const existingUrl = trimmedBranch ? `${urlBase}?ref=${encodeURIComponent(trimmedBranch)}` : urlBase;
    const existing = await githubRequestJson(existingUrl, {
      headers: { Authorization: authHeader }
    });
    if (existing && typeof existing === 'object' && existing.sha && existing.type === 'file') {
      existingSha = String(existing.sha);
    }
  } catch (error) {
    if (Number(error?.status) !== 404) {
      return { success: false, error: normalizeGitHubError(error) };
    }
  }

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
      commitSha: commit && commit.sha ? String(commit.sha) : null
    };
  } catch (error) {
    return { success: false, error: normalizeGitHubError(error) };
  }
}
