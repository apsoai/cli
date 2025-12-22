import { config } from './env.config';

export interface TokenConfig {
  accessTokenSecret: string;
  refreshTokenSecret: string;
}

export const token: TokenConfig = {
  accessTokenSecret: config.ACCESS_SECRET_TOKEN,
  refreshTokenSecret: config.REFRESH_SECRET_TOKEN,
};
