# QRONOS 2.0 · Eficiencia Inteligente

## Estructura del Proyecto
```
qronos/
├── index.html           ← PWA frontend principal
├── styles.css           ← UI premium glassmorphism
├── app.js               ← Lógica de la aplicación
├── manifest.json        ← Config PWA instalable
├── service-worker.js    ← Offline + caché
├── vercel.json          ← Configuración Vercel
├── package.json         ← Dependencias Node
├── .env.example         ← Variables de entorno (plantilla)
├── api/
│   ├── health.js        ← Health check endpoint
│   ├── records.js       ← CRUD Supabase (GET/POST/DELETE)
│   └── analizar.js      ← Integración Gemini AI
└── icons/               ← Iconos PWA (reemplazar)
```

## Despliegue en Vercel

### 1. Preparar Supabase
- Crea un proyecto en https://supabase.com
- En SQL Editor, ejecuta:
```sql
CREATE TABLE records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha DATE NOT NULL,
  planta TEXT NOT NULL,
  eficiencia DECIMAL(5,2) NOT NULL DEFAULT 0,
  meta DECIMAL(5,2) NOT NULL,
  afectaciones TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(fecha, planta)
);
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON records FOR ALL USING (true);
```
- Copia `Project URL` y `service_role` key (Settings → API)

### 2. Obtener API Key de Gemini
- Ve a https://aistudio.google.com/app/apikey
- Crea una nueva API key

### 3. Desplegar en Vercel
```bash
npm i -g vercel
vercel login
vercel --prod
```

### 4. Configurar Variables de Entorno en Vercel
En el dashboard de Vercel → tu proyecto → Settings → Environment Variables:
```
SUPABASE_URL         = https://xxxx.supabase.co
SUPABASE_SERVICE_KEY = eyJhbGci...
GEMINI_API_KEY       = AIzaSy...
FRONTEND_URL         = https://tu-proyecto.vercel.app
```

### 5. Iconos PWA
Reemplaza los archivos en `/icons/` con PNG reales.
Usa: https://realfavicongenerator.net

## Comandos de Voz
- "Qronos, resumen de eficiencias"
- "Qronos, mejor planta"
- "Qronos, peor planta"
- "Qronos, detener"
- "Qronos, [cualquier pregunta]" → envía al chat IA

## Lógica de 0%
- 0% = Día sin producción (paro programado o no programado)
- Los días en 0% son EXCLUIDOS de promedios, KPIs y tendencias
- Se muestran como ⛔ en tarjetas y como punto gris en gráficas
- No penalizan ningún KPI global

## Notas de Seguridad
- GEMINI_API_KEY nunca se expone al frontend
- Toda IA pasa por /api/analizar (backend Vercel)
- Supabase usa service_role key solo en backend
- CORS configurado para el dominio de Vercel
