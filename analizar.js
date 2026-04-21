// ============================================================
// QRONOS 2.0 · /api/analizar.js
// Integración segura con Gemini API — Vercel Serverless
// La API KEY NUNCA se expone al frontend
// ============================================================

const GEMINI_MODEL = 'gemini-1.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function setCORS(res) {
  const origin = process.env.FRONTEND_URL || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function buildSystemPrompt(records) {
  const plantasSummary = Object.entries(
    records.reduce((acc, r) => {
      if (!acc[r.planta]) acc[r.planta] = { eficiencias: [], afectaciones: [], meta: r.meta };
      if (r.eficiencia === 0) {
        acc[r.planta].diasDetenidos = (acc[r.planta].diasDetenidos || 0) + 1;
      } else {
        acc[r.planta].eficiencias.push(r.eficiencia);
      }
      if (r.afectaciones) acc[r.planta].afectaciones.push(`${r.fecha}: ${r.afectaciones}`);
      return acc;
    }, {})
  ).map(([planta, info]) => {
    const promedio =
      info.eficiencias.length > 0
        ? (info.eficiencias.reduce((a, b) => a + b, 0) / info.eficiencias.length).toFixed(1)
        : 'N/D';
    const brechaVsMeta = promedio !== 'N/D' ? (parseFloat(promedio) - info.meta).toFixed(1) : 'N/D';
    return (
      `  Planta: ${planta} | Meta: ${info.meta}% | Promedio real: ${promedio}% | ` +
      `Brecha vs meta: ${brechaVsMeta}% | Días detenidos: ${info.diasDetenidos || 0}\n` +
      (info.afectaciones.length
        ? `  Afectaciones recientes:\n    - ${info.afectaciones.slice(-3).join('\n    - ')}`
        : '  Sin afectaciones registradas.')
    );
  }).join('\n\n');

  return `Eres el Director de Operaciones Industriales de una planta de bebidas. 
Tienes acceso al dashboard QRONOS 2.0 con los siguientes datos actualizados:

RESUMEN DE PLANTAS:
${plantasSummary}

REGLAS DE ANÁLISIS:
1. Un valor de eficiencia 0% significa que esa planta estuvo DETENIDA ese día (no producción, no falla de eficiencia). Nunca lo interpretes como mal desempeño.
2. Los promedios y tendencias EXCLUYEN los días con 0% (días sin producción).
3. Analiza las afectaciones registradas para dar recomendaciones ACCIONABLES y específicas.
4. NUNCA inventes datos. Si no tienes información suficiente, indícalo claramente.
5. Sé directo, ejecutivo y orientado a resultados. Responde en español.
6. Usa máximo 3 bullets accionables en tus recomendaciones.
7. Si el usuario saluda o hace una pregunta casual, responde brevemente y de forma amigable.

Fecha de análisis: ${new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;
}

export default async function handler(req, res) {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Gemini API no configurada. Contacta al administrador.' });
  }

  try {
    const { pregunta, records = [], historial = [] } = req.body;

    if (!pregunta || typeof pregunta !== 'string' || pregunta.trim().length === 0) {
      return res.status(400).json({ error: 'Se requiere el campo "pregunta".' });
    }
    if (pregunta.length > 1000) {
      return res.status(400).json({ error: 'Pregunta demasiado larga (máx 1000 chars).' });
    }

    const systemPrompt = buildSystemPrompt(records);

    // Construir historial de conversación (máx últimos 6 mensajes)
    const conversationHistory = historial.slice(-6).map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Entendido. Soy tu Director de Operaciones en QRONOS 2.0. ¿En qué puedo ayudarte?' }] },
      ...conversationHistory,
      { role: 'user', parts: [{ text: pregunta }] },
    ];

    const geminiResponse = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 800,
          topP: 0.9,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        ],
      }),
    });

    if (!geminiResponse.ok) {
      const errData = await geminiResponse.json().catch(() => ({}));
      console.error('[QRONOS analizar] Gemini error:', errData);
      const msg =
        geminiResponse.status === 429
          ? 'Límite de solicitudes de IA alcanzado. Intenta en unos segundos.'
          : errData?.error?.message || `Error de Gemini (${geminiResponse.status})`;
      return res.status(502).json({ error: msg });
    }

    const geminiData = await geminiResponse.json();
    const candidate = geminiData?.candidates?.[0];

    if (!candidate || candidate.finishReason === 'SAFETY') {
      return res.status(422).json({ error: 'La IA no pudo procesar esta solicitud por políticas de seguridad.' });
    }

    const respuesta = candidate?.content?.parts?.map((p) => p.text).join('') || 'Sin respuesta.';

    return res.status(200).json({ respuesta, ok: true, model: GEMINI_MODEL });

  } catch (err) {
    console.error('[QRONOS analizar]', err);
    return res.status(500).json({ error: 'Error interno al procesar la solicitud de IA.' });
  }
}
