import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '..');
export const SERVER_DIR = __dirname;
export const DATA_DIR = process.env.PORTAL_DATA_DIR || path.join(SERVER_DIR, 'data');
export const CONFIG_YAML_PATH = process.env.PORTAL_CONFIG_PATH || path.join(ROOT_DIR, 'portal.config.yaml');

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '4242', 10),
  HOST: process.env.HOST || '0.0.0.0',
  AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET || 'dev-insecure-secret-placeholder-please-set-auth-jwt-secret',
  PROBE_AUTH_TOKEN: process.env.PROBE_AUTH_TOKEN || 'probe-secret-token-please-change-in-env',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  DATA_DIR,
  CONFIG_YAML_PATH
};
