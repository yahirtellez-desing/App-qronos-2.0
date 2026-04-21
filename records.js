// ============================================================
// QRONOS 2.0 · /api/records.js
// CRUD de registros via Supabase REST — Vercel Serverless
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TABLE = 'records';

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function setCORS(res) {
  const origin = process.env.FRONTEND_URL || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function supabaseFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const response = await fetch(url, { ...options });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase error ${response.status}`);
  }
  return data;
}

export default async function handler(req, res) {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase no configurado. Revisa las variables de entorno.' });
  }

  try {
    // ── GET /api/records ─────────────────────────────────────
    if (req.method === 'GET') {
      const { desde, hasta, planta, limit = 200 } = req.query;
      let query = `${TABLE}?order=fecha.desc&limit=${limit}`;
      if (desde)  query += `&fecha=gte.${desde}`;
      if (hasta)  query += `&fecha=lte.${hasta}`;
      if (planta) query += `&planta=eq.${encodeURIComponent(planta)}`;

      const data = await supabaseFetch(query, {
        headers: supabaseHeaders({ Prefer: 'count=planned' }),
      });
      return res.status(200).json({ data: Array.isArray(data) ? data : [], ok: true });
    }

    // ── POST /api/records — upsert uno o varios ──────────────
    if (req.method === 'POST') {
      const body = req.body;
      if (!body) return res.status(400).json({ error: 'Body requerido' });

      const records = (Array.isArray(body) ? body : [body]).map((r) => ({
        ...r,
        updated_at: new Date().toISOString(),
      }));

      // Validación básica
      for (const r of records) {
        if (!r.planta || r.fecha === undefined || r.eficiencia === undefined) {
          return res.status(400).json({ error: 'Campos requeridos: planta, fecha, eficiencia' });
        }
        if (r.eficiencia < 0 || r.eficiencia > 100) {
          return res.status(400).json({ error: `Eficiencia fuera de rango (0-100): ${r.eficiencia}` });
        }
      }

      const data = await supabaseFetch(
        `${TABLE}?on_conflict=fecha,planta`,
        {
          method: 'POST',
          headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
          body: JSON.stringify(records),
        }
      );
      return res.status(200).json({ data, ok: true });
    }

    // ── DELETE /api/records?id=uuid ──────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'ID requerido' });

      await supabaseFetch(`${TABLE}?id=eq.${id}`, {
        method: 'DELETE',
        headers: supabaseHeaders(),
      });
      return res.status(200).json({ ok: true, deleted: id });
    }

    return res.status(405).json({ error: `Método ${req.method} no permitido` });

  } catch (err) {
    console.error('[QRONOS records]', err);
    return res.status(500).json({ error: err.message || 'Error interno del servidor' });
  }
}
