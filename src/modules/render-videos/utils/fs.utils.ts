import { dirname } from 'path';
import * as fs from 'fs';

export const ensureDir = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
};

export const safeRmDir = (dir: string) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
};

export const safeCopyFile = (src: string, dest: string) => {
  ensureDir(dirname(dest));
  fs.copyFileSync(src, dest);
};
