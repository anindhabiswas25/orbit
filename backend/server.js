const express      = require('express');
const cors         = require('cors');
const cycleTrigger        = require('./services/cycle-trigger');
const fluctuationTrigger  = require('./services/fluctuation-trigger');
require('dotenv').config();

const app = express();

// Allow multiple local frontends (dashboard on :3000, landing on :3001) plus
// any extra origins listed in FRONTEND_URL (comma-separated). Requests with no
// Origin (curl, server-to-server) are always allowed.
const allowedOrigins = new Set(
  [
    'http://localhost:3000',
    'http://localhost:3001',
    ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : []),
  ].map((o) => o.trim()).filter(Boolean)
);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.has('*') || allowedOrigins.has(origin)) {
        return cb(null, true);
      }
      // Permit any localhost / 127.0.0.1 port during local hosting.
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return cb(null, true);
      }
      return cb(null, false);
    },
  })
);
app.use(express.json());
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

app.use('/api/status',    require('./routes/status'));
app.use('/api/protocols', require('./routes/protocols'));
app.use('/api/agents',    require('./routes/agents'));
app.use('/api/jobs',      require('./routes/jobs'));
app.use('/api/events',    require('./routes/events'));
app.use('/api/demo',      require('./routes/demo'));
app.use('/api/meta',      require('./routes/meta'));
app.get('/health', (_, res) => res.json({ ok: true, timestamp: Date.now() }));

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running → http://localhost:${PORT}`);
  cycleTrigger.start(); // auto-trigger scout cycles every 60s when vault has funds
  // Auto-fluctuation overwrites manually-set pool APYs. Off by default so the
  // dashboard APY controls stick; enable with AUTO_FLUCTUATE=true for a hands-off demo.
  if (process.env.AUTO_FLUCTUATE === 'true') {
    fluctuationTrigger.start(); // auto-fluctuate mock pool APYs every 10 minutes
  } else {
    console.log('[fluctuation-trigger] disabled (manual APY control). Set AUTO_FLUCTUATE=true to enable.');
  }
});
