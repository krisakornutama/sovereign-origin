// tests/wan-monitor.test.ts — pure functions (ไม่ ping จริง)
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parsePingLatency, pingResultFromExit } from '../src/services/wan-monitor.service.ts';

describe('WAN Monitor (Archer MR505)', () => {
  it('parsePingLatency: Linux "time=12.3 ms" → 12.3', () => {
    assert.equal(parsePingLatency('64 bytes from 1.1.1.1: icmp_seq=1 ttl=58 time=12.3 ms'), 12.3);
  });
  it('parsePingLatency: Windows "Average = 15ms" → 15', () => {
    assert.equal(parsePingLatency('Minimum = 10ms, Maximum = 20ms, Average = 15ms'), 15);
  });
  it('parsePingLatency: ไม่มี time → null', () => {
    assert.equal(parsePingLatency('Request timed out.'), null);
  });
  it('pingResultFromExit: exit 0 = UP, exit 1/null = DOWN', () => {
    assert.equal(pingResultFromExit(0, 12), true);
    assert.equal(pingResultFromExit(1, null), false);
    assert.equal(pingResultFromExit(null, null), false);
  });
});
