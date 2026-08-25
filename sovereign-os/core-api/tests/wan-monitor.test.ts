// tests/wan-monitor.test.ts — pure functions (ไม่ ping จริง)
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parsePingLatency, pingResultFromExit, ipFromSubnet, classifyWanIssue, parseSpeedtestMbps } from '../src/services/wan-monitor.service.ts';

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
  it('ipFromSubnet: สร้าง IP จาก subnet + host number', () => {
    assert.equal(ipFromSubnet('192.168.1', 5), '192.168.1.5');
    assert.equal(ipFromSubnet('10.0.0', 254), '10.0.0.254');
  });
  it('classifyWanIssue: แยก LAN_DOWN ออกจาก SIM_DOWN', () => {
    assert.equal(classifyWanIssue(true, true), 'OK');
    assert.equal(classifyWanIssue(false, true), 'LAN_DOWN'); // router ล่ม = สายแลน
    assert.equal(classifyWanIssue(false, false), 'LAN_DOWN'); // router ล่มนำเสมอ
    assert.equal(classifyWanIssue(true, false), 'SIM_DOWN'); // router ปกติ ซิมหลุด
  });
  it('parseSpeedtestMbps: 2MB ใน 2 วิ = 8 Mbps', () => {
    assert.equal(parseSpeedtestMbps(2_000_000, 2000), 8);
    assert.equal(parseSpeedtestMbps(0, 1000), 0);
    assert.equal(parseSpeedtestMbps(1000, 0), 0);
  });
});
