import type { PodcastEpisode } from './podcast';

/**
 * 播客整集译文的台词指纹。
 *
 * **必须与后端 `coach.SourceHash` 逐字节一致**：服务端按这个指纹判定
 * 「这一集的译文还对不对」，算法不同就永远命中不了缓存，等于每次播放
 * 都重新生成。
 *
 * 算法：按顺序把每句 trim 后写入、每句后跟一个 0 字节，取 SHA-256 的
 * 小写十六进制。句序参与哈希——只对内容做哈希的话，两句互换会得到同一个
 * 指纹，而整集译文的顺序就错了。
 *
 * 纯 TS 实现而不是 `expo-crypto`：`lib/` 这一层要能在 Node 测试里直接跑
 * （见 AGENTS.md 的「纯逻辑那层改完立刻能验」），不能依赖原生模块。
 */
export function podcastSourceHash(lines: string[]): string {
  const bytes: number[] = [];
  for (const line of lines) {
    for (const byte of new TextEncoder().encode(line.trim())) bytes.push(byte);
    bytes.push(0);
  }
  return sha256Hex(new Uint8Array(bytes));
}

/** 一集台词的纯文本列表，指纹与请求体都用它。 */
export function episodeSourceLines(episode: PodcastEpisode): string[] {
  return episode.turns.map((turn) => turn.content);
}

/** 一集台词的说话人；课程数据里 role 就是说话人标识。 */
export function episodeSpeakers(episode: PodcastEpisode): string[] {
  return episode.turns.map((turn) => turn.role);
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(input: Uint8Array): string {
  const bitLength = input.length * 8;
  // 补位后长度必须是 64 的倍数，且至少容纳 1 字节 0x80 与 8 字节长度。
  const paddedLength = ((input.length + 9 + 63) >> 6) << 6;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(input);
  buffer[input.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      w[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(w[index - 15], 7) ^ rotr(w[index - 15], 18) ^ (w[index - 15] >>> 3);
      const s1 = rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + K[index] + w[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  let out = '';
  for (const value of h) out += value.toString(16).padStart(8, '0');
  return out;
}
