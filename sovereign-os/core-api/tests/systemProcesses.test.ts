import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert';
import {
  parseTasklistOutput,
  parsePsOutput,
  listProcesses,
} from '../src/services/system-processes.service';

test('parses Windows tasklist CSV output (quoted values, comma in memory)', () => {
  const raw = `"chrome.exe","1234","Console","1","345,678 K"\r\n"svchost.exe","5678","Services","0","12,345 K"\r\n`;
  assert.deepStrictEqual(parseTasklistOutput(raw), [
    { pid: 1234, name: 'chrome.exe', mem: '345,678 K' },
    { pid: 5678, name: 'svchost.exe', mem: '12,345 K' },
  ]);
});

test('parses Linux ps output (leading whitespace, empty lines ignored)', () => {
  const raw = `  1234 chrome\n  5678 systemd\n\n`;
  assert.deepStrictEqual(parsePsOutput(raw), [
    { pid: 1234, name: 'chrome' },
    { pid: 5678, name: 'systemd' },
  ]);
});

test('listProcesses returns a sorted array of real processes', async () => {
  const procs = await listProcesses();
  assert.ok(Array.isArray(procs));
  assert.ok(procs.length > 0, 'expected at least one process');
  assert.ok(
    procs.every((p) => Number.isInteger(p.pid) && p.pid > 0 && typeof p.name === 'string' && p.name.length > 0)
  );
  // sorted by pid ascending
  for (let i = 1; i < procs.length; i++) {
    assert.ok(procs[i - 1].pid <= procs[i].pid, 'processes should be sorted by pid');
  }
});
