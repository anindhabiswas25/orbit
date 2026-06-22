// Structured JSON logger. All agent logs are newline-delimited JSON.
// Backend can tail this for the activity feed.
// Format: { timestamp, level, agent, message, ...data }

const AGENT_NAME = process.env.AGENT_NAME || 'unknown-agent';

function log(level, message, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    agent: AGENT_NAME,
    message,
    ...data,
  };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

module.exports = {
  info:  (msg, data) => log('info',  msg, data),
  warn:  (msg, data) => log('warn',  msg, data),
  error: (msg, data) => log('error', msg, data),
  debug: (msg, data) => {
    if (process.env.LOG_LEVEL === 'debug') log('debug', msg, data);
  },
};
