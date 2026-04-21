// Trigger immediate processing of the CMS queue
// Endpoint confirms the trigger was called; Sage polls the queue independently

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
    // Log the trigger call (optional: could write to a file or send a notification)
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] CMS queue processing triggered`);

    // Return success - Sage will check the queue on its own schedule
    return res.status(200).json({
      success: true,
      message: 'Queue processing triggered',
      timestamp,
      note: 'Sage will check the queue shortly'
    });

  } catch (error) {
    console.error('Process API error:', error);
    return res.status(500).json({
      error: error.message
    });
  }
}
