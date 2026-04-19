// Vercel Serverless Function - Chat API
// Handles edit requests, calls Claude, commits to GitHub, triggers deploy

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;

// Site config - in production, this would be per-client from a database
const SITE_CONFIG = {
  repo: 'pixel-purpose/wa-test-site',
  branch: 'main',
  mainFile: 'index.html'
};

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, type } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    // 1. Fetch current HTML from GitHub
    const currentHtml = await fetchFileFromGitHub(SITE_CONFIG.repo, SITE_CONFIG.mainFile, SITE_CONFIG.branch);

    // 2. Call Claude to generate the edit
    const editResult = await callClaude(message, currentHtml, type);

    if (!editResult.success) {
      return res.status(200).json({
        success: false,
        message: editResult.message
      });
    }

    // 3. Commit the changes to GitHub
    const commitResult = await commitToGitHub(
      SITE_CONFIG.repo,
      SITE_CONFIG.mainFile,
      editResult.newHtml,
      `CMS: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`,
      SITE_CONFIG.branch
    );

    // 4. Vercel auto-deploys on push, but we can return the preview URL
    return res.status(200).json({
      success: true,
      message: editResult.message,
      changes: editResult.changes,
      commitSha: commitResult.sha,
      deployUrl: `https://wa-test-site.vercel.app`
    });

  } catch (error) {
    console.error('Chat API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
}

async function fetchFileFromGitHub(repo, path, branch = 'main') {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`,
    {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
    sha: data.sha
  };
}

async function callClaude(userMessage, currentFile, type = 'edits') {
  const systemPrompt = type === 'edits' 
    ? `You are a web developer assistant that modifies HTML/CSS/JS files based on user requests.

You will receive the current HTML file and a user request. Your job is to:
1. Understand what change they want
2. Make the minimal necessary edits to achieve it
3. Return the COMPLETE modified HTML file

Rules:
- Preserve all existing styles, scripts, and structure unless explicitly asked to change them
- Make surgical, targeted edits
- Keep the same code style and formatting
- If you can't make the change or don't understand, explain why

Respond in this JSON format:
{
  "success": true,
  "message": "Brief description of what you changed",
  "changes": ["List of specific changes made"],
  "html": "THE COMPLETE MODIFIED HTML FILE"
}

If you cannot make the change:
{
  "success": false,
  "message": "Explanation of why you can't make this change"
}`
    : `You are a content writer that creates blog posts in HTML format.

You will receive the current site HTML and a request to create a post. Your job is to:
1. Write the blog post content
2. Format it as HTML that matches the site's existing style
3. Add it to an appropriate location in the HTML (or create a posts section if none exists)

Respond in this JSON format:
{
  "success": true,
  "message": "Brief description of the post created",
  "changes": ["Created new post: Title"],
  "html": "THE COMPLETE MODIFIED HTML FILE WITH THE NEW POST"
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Current HTML file:\n\n${currentFile.content}\n\n---\n\nUser request: ${userMessage}`
        }
      ]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
  }

  const data = await response.json();
  const responseText = data.content[0].text;

  // Parse JSON from response (handle markdown code blocks)
  let jsonStr = responseText;
  if (responseText.includes('```json')) {
    jsonStr = responseText.split('```json')[1].split('```')[0];
  } else if (responseText.includes('```')) {
    jsonStr = responseText.split('```')[1].split('```')[0];
  }

  const result = JSON.parse(jsonStr.trim());

  return {
    success: result.success,
    message: result.message,
    changes: result.changes || [],
    newHtml: result.html
  };
}

async function commitToGitHub(repo, path, content, message, branch = 'main') {
  // First get the current file SHA
  const currentFile = await fetchFileFromGitHub(repo, path, branch);

  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString('base64'),
        sha: currentFile.sha,
        branch
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub commit failed: ${error}`);
  }

  const data = await response.json();
  return { sha: data.commit.sha };
}
