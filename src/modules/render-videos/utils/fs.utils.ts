import { dirname, join } from 'path';
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

export const safeCopyDirContents = (srcDir: string, destDir: string) => {
  ensureDir(destDir);

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      safeCopyDirContents(srcPath, destPath);
      continue;
    }

    if (entry.isFile()) {
      safeCopyFile(srcPath, destPath);
    }
  }
};
