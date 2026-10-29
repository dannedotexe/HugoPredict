'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const write = (lvl, args) => {
    if (LEVELS[lvl] < threshold) return;
    const line = `[${new Date().toISOString()}] ${lvl.toUpperCase().padEnd(5)}`;
    (lvl === 'error' ? console.error : lvl === 'warn' ? console.warn : console.log)(line, ...args);
  };
  return {
    debug: (...a) => write('debug', a),
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
  };
}

module.exports = { createLogger };
