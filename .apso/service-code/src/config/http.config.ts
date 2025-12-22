import { config } from './env.config';

export interface CookieConfig {
  httpOnly: boolean;
  path: string;
  domain: string;
  sameSite: boolean | 'lax' | 'strict' | 'none';
  secure: boolean;
}

export const cookie: CookieConfig = {
  httpOnly: config.COOKIE_HTTP_ONLY,
  path: config.COOKIE_PATH,
  domain: config.COOKIE_DOMAIN,
  sameSite: config.COOKIE_SAME_SITE,
  secure: Boolean(config.COOKIE_SECURE),
};

export interface SessionConfig {
  key: string;
  secret: string;
  ttl: number;
}

export const session: SessionConfig = {
  key: config.SESSION_KEY,
  secret: config.SESSION_SECRET,
  ttl: 60 * 60 * 24,
};
