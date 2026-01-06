import { BinaryLike, CipherKey, createDecipheriv } from "crypto";

/**
   * Decrypt GitHub access token
   * TODO: Move this to a shared utility
   */
export const decrypt = (token: string): string => {
  const aesKeyB64 =
    process.env.AES_KEY_B64 ||
    '7N0eyS0YaZXKlXBK+tSY+3i/tKrKWqjrwaK++XtJSn8=';
  const key = Buffer.from(aesKeyB64, 'base64');
  const [ivB64, dataB64, tagB64] = token.split('.');
  if (!ivB64 || !dataB64 || !tagB64) throw new Error('Invalid token format');

  const iv = Buffer.from(ivB64, 'base64url');
  const encrypted = Buffer.from(dataB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');

  const decipher = createDecipheriv(
    'aes-256-gcm',
    key as CipherKey,
    iv as BinaryLike,
    {
      authTagLength: 16,
    },
  );

  decipher.setAuthTag(tag as NodeJS.ArrayBufferView);

  const decrypted = Buffer.concat([
    decipher.update(encrypted as any),
    decipher.final(),
  ] as any);
  return decrypted.toString('utf8');
}