// Must be imported before anything that reads process.env.
import fs from 'node:fs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
