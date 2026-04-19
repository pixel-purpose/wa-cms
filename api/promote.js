// Promote staging to production
// Copies the current staging site content to the production repo

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const SITES = {
  'wa-test-site': {
    stagingRepo: 'pixel-purpose/wa-test-site',
    productionRepo: 'pixel-purpose/wa-test-site-production',
    files: ['index.html']
  }
};

export default async function handler(req, res) {
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
    const { site } = req.body;
    const config = SITES[site];

    if (!config) {
      return res.status(400).json({ error: `Unknown site: ${site}` });
    }

    const results = [];

    for (const file of config.files) {
      // Fetch from staging
      const stagingContent = await fetchFile(config.stagingRepo, file);
      
      // Get production file SHA (for update)
      let productionSha = null;
      try {
        const prodFile = await fetchFile(config.productionRepo, file);
        productionSha = prodFile.sha;
      } catch (e) {
        // File doesn't exist in production yet
      }

      // Push to production
      await saveFile(
        config.productionRepo,
        file,
        stagingContent.content,
        `Promote from staging: ${new Date().toISOString()}`,
        productionSha
      );

      results.push(file);
    }

    return res.status(200).json({
      success: true,
      message: `Promoted ${results.length} file(s) to production`,
      files: results
    });

  } catch (error) {
    console.error('Promote API error:', error);
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
    throw new Error(`Failed to fetch ${path} from ${repo}`);
  }

  const data = await response.json();
  return {
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
    sha: data.sha
  };
}

async function saveFile(repo, path, content, message, sha = null) {
  const body = {
    message,
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
    throw new Error(`Failed to save ${path}: ${error}`);
  }

  return response.json();
}
