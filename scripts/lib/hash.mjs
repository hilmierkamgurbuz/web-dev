import crypto from 'node:crypto';
import fs from 'node:fs';

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function short(value, length = 8) {
  return sha256(value).slice(0, length);
}

export function fileSha(file) {
  try {
    return sha256(fs.readFileSync(file));
  } catch {
    return null;
  }
}
