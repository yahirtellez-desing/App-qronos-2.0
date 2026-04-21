// ============================================================
// QRONOS 2.0 · /api/health.js
// Health check endpoint — Vercel Serverless Function
// ============================================================

export default function handler(req, res) {
  const origin = process.env.FRONTEND_URL || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const checks = {
    supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
    gemini: !!process.env.GEMINI_API_KEY,
  };

  const allOk = Object.values(checks).every(Boolean);

  return res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    checks,
    uptime: process.uptime(),
  });
}
