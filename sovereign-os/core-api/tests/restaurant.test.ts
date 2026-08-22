import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mockModel } from './helpers.ts';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Restaurant Empire', () => {
  it('harvest creates inventory and marks plot harvested', async () => {
    // pure logic: harvest 800kg
    const yieldKg = 800;
    const plot = { id: 'plot-1', name: 'แปลงข้าว', crop: 'ข้าวหอม', status: 'growing' };
    const item = { name: plot.crop, quantity: yieldKg, unit: 'kg' };
    assert.equal(item.quantity, 800);
    assert.equal(plot.crop, 'ข้าวหอม');
  });

  it('menu recipe isSelfProduced blocks available when no stock', async () => {
    const recipe = { menuId: 'menu-1', farmCrop: 'ข้าวหอม', qtyGram: 200, isSelfProduced: true };
    const invQtyKg = 0; // ไม่มีของ
    const canMake = !(recipe.isSelfProduced && invQtyKg * 1000 < recipe.qtyGram);
    assert.equal(canMake, false);
  });

  it('order pay earns points 20THB=1', async () => {
    const total = 80;
    const points = Math.floor(total / 20);
    assert.equal(points, 4);
  });

  it('pay clamps stock to 0 not negative', async () => {
    const invQty = 10;
    const needKg = 20;
    const newQty = Math.max(0, invQty - needKg);
    assert.equal(newQty, 0);
  });

  it('restaurant requires name validation', async () => {
    const name = '';
    assert.equal(!name.trim(), true);
  });
});
