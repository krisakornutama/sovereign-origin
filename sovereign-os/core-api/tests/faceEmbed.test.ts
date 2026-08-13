// TDD: ระบบจดจำใบหน้าด้วย embedding — เปรียบเทียบความคล้ายเชิงตัวเลข (ไม่พึ่ง LLM ในการตัดสิน)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cosineSimilarity,
  hammingDistance,
  matchFaceByEmbedding,
  matchFaceByDhash,
  embedFace,
  setFaceOllama,
  FACE_EMBED_THRESHOLD,
} from '../src/services/face-embed.service';

test('cosineSimilarity returns 1 for identical vectors', () => {
  assert.equal(cosineSimilarity([0.1, 0.2, 0.3], [0.1, 0.2, 0.3]), 1);
});

test('cosineSimilarity returns 0 for orthogonal vectors', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
});

test('cosineSimilarity handles zero vectors safely', () => {
  assert.equal(cosineSimilarity([0, 0, 0], [1, 1, 1]), 0);
});

test('hammingDistance counts differing bits between two dhash hex strings', () => {
  // '00' vs '03' → bits differ in the low 2 bits of second byte → 2
  assert.equal(hammingDistance('00', '03'), 2);
  assert.equal(hammingDistance('ff', '00'), 8);
  assert.equal(hammingDistance('a5', 'a5'), 0);
});

test('matchFaceByEmbedding picks the best-known face above threshold', () => {
  const faces = [
    { id: 'f1', name: 'พ่อ', embedding: [1, 0, 0] },
    { id: 'f2', name: 'แม่', embedding: [0, 1, 0] },
  ];
  const result = matchFaceByEmbedding([0.95, 0.05, 0], faces);
  assert.equal(result?.name, 'พ่อ');
  assert.ok((result?.similarity ?? 0) >= FACE_EMBED_THRESHOLD);
});

test('matchFaceByEmbedding returns null when nothing is similar enough (stranger)', () => {
  const faces = [{ id: 'f1', name: 'พ่อ', embedding: [1, 0, 0] }];
  const result = matchFaceByEmbedding([0, 1, 0], faces);
  assert.equal(result, null);
});

test('matchFaceByDhash treats close hashes as the same person, far as stranger', () => {
  const faces = [{ id: 'f1', name: 'พ่อ', dhash: 'ffffffffffffffff' }];
  assert.equal(matchFaceByDhash('ffffff00ffffffff', faces)?.name, 'พ่อ');
  assert.equal(matchFaceByDhash('0000000000000000', faces), null);
});

test('embedFace falls back to describe->nomic embedding and stores method', async () => {
  const calls: string[] = [];
  setFaceOllama({
    generate: async (url, body) => {
      calls.push(url);
      return { data: { response: 'ชายไทย อายุประมาณ 40 ปี' } };
    },
    embed: async (url, body) => {
      calls.push(url);
      return { data: { embeddings: [[0.5, -0.5, 0.25]] } };
    },
    tags: async () => ({ data: { models: [{ name: 'qwen3-vl:8b' }, { name: 'nomic-embed-text' }] } }),
  });
  const result = await embedFace('data:image/jpeg;base64,AAAA');
  assert.ok(Array.isArray(result?.embedding));
  assert.equal(result?.embedding?.length, 3);
  assert.equal(result?.method, 'describe-nomic');
  assert.equal(calls.length, 2); // generate แล้ว embed
});

test('embedFace returns null embedding when Ollama fails (ลงทะเบียนได้แต่รอ embedding)', async () => {
  setFaceOllama({
    generate: async () => {
      throw new Error('ollama down');
    },
    embed: async () => {
      throw new Error('ollama down');
    },
    tags: async () => ({ data: { models: [] } }),
  });
  const result = await embedFace('data:image/jpeg;base64,AAAA');
  assert.equal(result?.embedding, null);
  assert.equal(result?.method, 'none');
});
