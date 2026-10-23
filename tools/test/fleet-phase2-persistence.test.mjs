#!/usr/bin/env node
// Fleet Phase 2 — persisted model wiring guards.
// กันการถอยกลับไป file-backed โดยไม่ตั้งใจ / migration หาย / ตารางใหม่ไม่มีเจ้าของ.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const MIGRATION = 'sovereign-os/core-api/prisma/migrations/20261023150000_fleet_persisted_model/migration.sql';
const SCHEMA = 'sovereign-os/core-api/prisma/schema.prisma';
const ROUTES = 'sovereign-os/core-api/src/modules/fleet/fleet.routes.ts';
const POLICY = 'sovereign-os/core-api/src/services/fleet-policy.service.ts';
const ENROLL = 'sovereign-os/core-api/src/services/fleet-enrollment.service.ts';
const BACKFILL = 'sovereign-os/core-api/scripts/fleet-backfill.mjs';

describe('Fleet Phase 2 — persisted model', () => {
  test('migration สร้างตาราง fleet_* + view และไม่แตะตารางอื่น', () => {
    const sql = read(MIGRATION);
    for (const table of [
      'fleet_sites',
      'fleet_groups',
      'fleet_settings',
      'fleet_channels',
      'fleet_rollouts',
      'fleet_machine_overrides',
      'fleet_enrollment_tokens',
      'fleet_enrollment_uses',
    ]) {
      assert.ok(sql.includes(`CREATE TABLE "${table}"`), `migration ต้องสร้าง ${table}`);
    }
    assert.ok(sql.includes('CREATE OR REPLACE VIEW "fleet_audit_view"'), 'ต้องมี fleet_audit_view');
    assert.ok(!/DROP\s+(TABLE|CONSTRAINT)\s+"(agent_|business_|audit_)/i.test(sql), 'ห้าม drop ตาราง/constraint ของโมดูลอื่น');
  });

  test('schema มี FK override → agent_machines + unique ของ site/group/token', () => {
    const schema = read(SCHEMA);
    for (const model of [
      'FleetSite',
      'FleetGroup',
      'FleetSetting',
      'FleetChannel',
      'FleetRollout',
      'FleetMachineOverride',
      'FleetEnrollmentToken',
      'FleetEnrollmentUse',
    ]) {
      assert.ok(new RegExp(`model\\s+${model}\\s*\\{`).test(schema), `schema ต้องมี model ${model}`);
    }
    assert.ok(schema.includes('fleet_override FleetMachineOverride?'), 'AgentMachine ต้องมี relation ไป override');
    assert.ok(schema.includes('machine_id String   @id @db.Uuid'), 'override ต้องใช้ machine_id เป็น PK/FK');
    assert.ok(schema.includes('@@unique([site_id, name])') || schema.includes('name       String   @unique'), 'site/group name ต้อง unique');
  });

  test('module owners รู้จักตาราง/บริการ fleet', () => {
    const owners = JSON.parse(read('tools/module-owners.json'));
    for (const table of [
      'fleet_sites',
      'fleet_groups',
      'fleet_settings',
      'fleet_channels',
      'fleet_rollouts',
      'fleet_machine_overrides',
      'fleet_enrollment_tokens',
      'fleet_enrollment_uses',
    ]) {
      assert.equal(owners.owners[table], 'fleet', `${table} ต้องเป็นของ fleet`);
    }
    for (const service of [
      'fleet-policy.service',
      'fleet-enrollment.service',
      'fleet-overview.service',
      'fleet-persistence.service',
    ]) {
      assert.equal(owners.serviceAliases[service], 'fleet', `${service} ต้อง alias เป็น fleet`);
    }
  });

  test('production routes ใช้ DB-backed loaders และมี audit', () => {
    const routes = read(ROUTES);
    assert.ok(routes.includes('loadFleetPolicy'), 'routes ต้องใช้ loadFleetPolicy');
    assert.ok(routes.includes('listEnrollTokensDb'), 'routes ต้องใช้ listEnrollTokensDb');
    assert.ok(routes.includes("router.get('/audit'"), 'routes ต้องมี /audit');
    assert.ok(routes.includes("router.get('/sites'"), 'routes ต้องมี /sites');
    assert.ok(routes.includes("router.get('/groups'"), 'routes ต้องมี /groups');
    assert.ok(routes.includes("requireRole('SUPERADMIN')"), 'ทุก route ต้อง SUPERADMIN');

    const policy = read(POLICY);
    const enroll = read(ENROLL);
    assert.ok(policy.includes('loadFleetPolicyFromDb'), 'policy ต้องอ่านจาก DB');
    assert.ok(policy.includes('saveFleetPolicyToDb'), 'policy ต้องเขียน DB');
    assert.ok(enroll.includes('listEnrollTokensDb'), 'enrollment ต้องมี DB list');
    assert.ok(enroll.includes('fleetEnrollmentUse.create'), 'consume ต้องเขียน use log');
  });

  test('backfill idempotent + default dry-run', () => {
    const script = read(BACKFILL);
    assert.ok(script.includes('.upsert('), 'backfill ต้อง upsert');
    assert.ok(script.includes('--apply'), 'backfill ต้องมี --apply');
    assert.ok(script.includes('dry-run'), 'backfill ต้อง dry-run เป็นค่าเริ่มต้น');
    assert.ok(!script.includes('console.log(counts.token'), 'ห้ามพิมพ์ token');
  });
});
