import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve(process.argv[2] ?? 'artifacts/ffmpeg-render/fixtures');
mkdirSync(output, { recursive: true });

const width = 16;
const height = 16;
const frames = 30;
const video = Buffer.alloc(width * height * 3 * frames);
for (let frame = 0; frame < frames; frame += 1) {
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = (frame * width * height + pixel) * 3;
    video[offset] = (frame * 7 + pixel) % 256;
    video[offset + 1] = (pixel * 5 + frame) % 256;
    video[offset + 2] = (frame * 3 + pixel * 2) % 256;
  }
}
writeFileSync(resolve(output, 'input.rgb24'), video);

const sampleRate = 48_000;
const channels = 2;
const audioFrames = sampleRate / 2;
const pcm = Buffer.alloc(audioFrames * channels * 2);
for (let frame = 0; frame < audioFrames; frame += 1) {
  const sample = Math.round(Math.sin((2 * Math.PI * 440 * frame) / sampleRate) * 8_000);
  for (let channel = 0; channel < channels; channel += 1)
    pcm.writeInt16LE(sample, (frame * channels + channel) * 2);
}
const wav = Buffer.alloc(44 + pcm.length);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + pcm.length, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(channels, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * channels * 2, 28);
wav.writeUInt16LE(channels * 2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(pcm.length, 40);
pcm.copy(wav, 44);
writeFileSync(resolve(output, 'narration.wav'), wav);

console.log(JSON.stringify({ output, video_bytes: video.length, narration_bytes: wav.length }));
