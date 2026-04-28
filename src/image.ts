import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

export async function fileSha256(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash('sha256').update(data).digest('hex');
}

export function bufferSha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function mimeForExt(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '');
  if (e === 'png') return 'image/png';
  return 'image/jpeg';
}

export function toDataUri(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

export async function getImageDimensions(path: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(path).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Could not determine dimensions for ${path}`);
  }
  return { width: meta.width, height: meta.height };
}

export async function getBufferDimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not determine dimensions for buffer');
  }
  return { width: meta.width, height: meta.height };
}

export async function resizeBufferTo(
  buffer: Buffer,
  width: number,
  height: number,
  outputPath: string,
): Promise<void> {
  const out = await sharp(buffer)
    .resize(width, height, { fit: 'fill' })
    .jpeg({ quality: 92 })
    .toBuffer();
  await writeFile(outputPath, out);
}

export async function writeBuffer(path: string, buf: Buffer): Promise<void> {
  await writeFile(path, buf);
}
