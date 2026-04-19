// Queue a site edit request
// Writes to a JSON file that OpenClaw polls

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const QUEUE_REPO = 'pixel-purpose/wa-cms';
const QUEUE_FILE = 'queue/pending.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'POST') {
      // Add new request to queue
      const { message, type, site } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: 'Message required' });
      }

      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const request = {
        id: requestId,
        message,
        type: type || 'edits',
        site: site || 'wa-test-site',
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      // Get current queue
      let queue = [];
      let queueSha = null;
      
      try {
        const current = await fetchFile(QUEUE_REPO, QUEUE_FILE);
        queue = JSON.parse(current.content);
        queueSha = current.sha;
      } catch (e) {
        // File doesn't exist yet, start fresh
      }

      // Add request
      queue.push(request);

      // Save queue
      await saveFile(QUEUE_REPO, QUEUE_FILE, JSON.stringify(queue, null, 2), queueSha);

      return res.status(200).json({
        success: true,
        requestId,
        message: 'Request queued for processing'
      });

    } else if (req.method === 'GET') {
      // Check status of a request
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'Request ID required' });
      }

      // Check pending queue
      try {
        const pending = await fetchFile(QUEUE_REPO, QUEUE_FILE);
        const queue = JSON.parse(pending.content);
        const request = queue.find(r => r.id === id);
        
        if (request) {
          return res.status(200).json(request);
        }
      } catch (e) {}

      // Check completed
      try {
        const completed = await fetchFile(QUEUE_REPO, `queue/completed/${id}.json`);
        return res.status(200).json(JSON.parse(completed.content));
      } catch (e) {}

      return res.status(404).json({ error: 'Request not found' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Request API error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function fetchFile(repo, path) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}`,
    {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`File not found: ${path}`);
  }

  const data = await response.json();
  return {
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
    sha: data.sha
  };
}

async function saveFile(repo, path, content, sha = null) {
  const body = {
    message: `Queue update: ${new Date().toISOString()}`,
    content: Buffer.from(content).toString('base64')
  };
  
  if (sha) {
    body.sha = sha;
  }

  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to save file: ${error}`);
  }

  return response.json();
}
