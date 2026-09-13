import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { computeNarrationAudioArtifactHashV1 } from '../../packages/render/dist/index.js';
import { hashFile } from '../../packages/domain-media-index/dist/index.js';

function runProbe(executable, inputPath) {
  const args = [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_entries',
    'format=duration,format_name:stream=codec_type,codec_name,sample_rate,channels,channel_layout',
    inputPath,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (action) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
    };
    const append = (current, chunk) => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next, 'utf8') > 1024 * 1024) {
        child.kill('SIGKILL');
        finish(() => reject(new Error('REAL_NARRATION_INPUT_REQUIRED')));
      }
      return next;
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error('REAL_NARRATION_INPUT_REQUIRED')));
    }, 30_000);
    child.stdout.on('data', (chunk) => (stdout = append(stdout, chunk)));
    child.stderr.on('data', (chunk) => (stderr = append(stderr, chunk)));
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (code) => {
      if (code !== 0) {
        finish(() =>
          reject(
            new Error(
              `REAL_NARRATION_INPUT_REQUIRED: ffprobe exit ${code}: ${stderr.slice(-1000)}`,
            ),
          ),
        );
        return;
      }
      try {
        finish(() => resolve(JSON.parse(stdout)));
      } catch (error) {
        finish(() => reject(new Error('REAL_NARRATION_INPUT_REQUIRED', { cause: error })));
      }
    });
  });
}

export async function deriveNarrationArtifact(config, ffprobePath) {
  try {
    const probe = await runProbe(ffprobePath, config.source_path);
    const audioStreams = (probe.streams ?? []).filter((stream) => stream.codec_type === 'audio');
    if (audioStreams.length !== 1) throw new Error('REAL_NARRATION_INPUT_REQUIRED');
    const audio = audioStreams[0];
    const duration = Number(probe.format?.duration);
    const sampleRate = Number(audio.sample_rate);
    const channels = Number(audio.channels);
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !Number.isSafeInteger(sampleRate) ||
      sampleRate <= 0 ||
      !Number.isSafeInteger(channels) ||
      channels <= 0 ||
      typeof audio.codec_name !== 'string' ||
      typeof audio.channel_layout !== 'string' ||
      typeof probe.format?.format_name !== 'string'
    ) {
      throw new Error('REAL_NARRATION_INPUT_REQUIRED');
    }
    const details = await stat(config.source_path);
    const preimage = {
      schema_version: '1.0',
      narration_audio_id: config.narration_audio_id,
      artifact_id: config.artifact_id,
      artifact_sha256: await hashFile(config.source_path),
      duration_ms: Math.round(duration * 1000),
      duration_measurement: 'CONTAINER_REPORTED',
      sample_count: null,
      codec: audio.codec_name,
      container: probe.format.format_name,
      sample_rate_hz: sampleRate,
      channels,
      channel_layout: audio.channel_layout,
      size_bytes: details.size,
      producer_ref: config.producer_ref,
      provenance_ref: config.provenance_ref,
    };
    return { ...preimage, artifact_hash: computeNarrationAudioArtifactHashV1(preimage) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('REAL_NARRATION_INPUT_REQUIRED')) {
      throw error;
    }
    throw new Error('REAL_NARRATION_INPUT_REQUIRED', { cause: error });
  }
}
