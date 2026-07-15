export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ADMIN_PASSPHRASE: string;
  SESSION_SECRET: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  APP_ORIGIN: string;
}
