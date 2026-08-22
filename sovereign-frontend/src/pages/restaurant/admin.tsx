"use client";
import { useState, useEffect } from "react";
import Sidebar from "../../components/layout/Sidebar";
import PageHeader from "../../components/ui/PageHeader";
import Icon from "../../components/ui/Icon";
import { authFetch } from "../../lib/apiFetch";
import { asArray } from "../../lib/fetchJson";
import { useAuthStore } from "../../stores/useAuthStore";
import { useLanguageStore } from "../../stores/useLanguageStore";
import Link from "next/link";

export default function RestaurantAdminPage() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [restaurants, setRestaurants] = useState<any[]>([]);
  const [selected, setSelected] = useState("");
  const [menus, setMenus] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("FOOD");
  const [editing, setEditing] = useState<string|null>(null);
  const [recipeLines, setRecipeLines] = useState<any[]>([{ farmCrop: "", qtyGram: 100, isSelfProduced: true }]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");

  const load = async () => {
    const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant`);
    if(r.ok){ const d=await r.json(); setRestaurants(d); if(d[0]&&!selected) setSelected(d[0].id); }
    const inv = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/inventory?limit=100`);
    if(inv.ok){ const d=await inv.json(); setInventory(d.items||d||[]); }
  };
  const loadMenus = async (rid:string) => {
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/menus?restaurantId=${rid}`);
    if(res.ok) setMenus(asArray(await res.json()));
  };
  useEffect(()=>{ if(isAuthenticated) load(); },[isAuthenticated]);
  useEffect(()=>{ if(selected) loadMenus(selected); },[selected]);

  const createMenu = async () => {
    if(!selected||!name||!price) return setErr(t('restaurant.admin.needNamePrice', 'ใส่ชื่อและราคา'));
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/menus`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({restaurantId:selected,name,priceTHB:Number(price),category})});
    const d=await res.json();
    if(res.ok){ setMsg(t('restaurant.admin.menuCreated', 'สร้างเมนูแล้ว')); setName(""); setPrice(""); loadMenus(selected); } else setErr(d.error);
  };
  const saveRecipe = async (menuId:string) => {
    const lines = recipeLines.filter(l=>l.qtyGram>0 && (l.farmCrop||l.inventoryItemId)).map(l=>({ farmCrop: l.farmCrop||null, inventoryItemId: l.inventoryItemId||null, qtyGram: Number(l.qtyGram), isSelfProduced: !!l.isSelfProduced }));
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/menus/${menuId}/recipe`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({lines})});
    if(res.ok){ setMsg(t('restaurant.admin.recipeSaved', 'บันทึกสูตรแล้ว — ใช้ของผลิตเองจะเช็คสต็อกก่อนขาย')); loadMenus(selected); setEditing(null); } else setErr(t('restaurant.admin.recipeSaveFailed', 'บันทึกสูตรไม่สำเร็จ'));
  };
  const bindCamera = async () => {
    if(!selected) return;
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/${selected}/camera`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({cameraId: cameraId||null})});
    if(res.ok) setMsg(t('restaurant.admin.cameraBound', 'ผูกกล้องแล้ว')); else setErr(t('restaurant.admin.cameraBindFailed', 'ผูกกล้องไม่สำเร็จ'));
  };

  if(!isHydrated) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t('restaurant.loading', 'กำลังโหลด...')}</div>;
  if(!isAuthenticated) return <div className="text-white p-8">{t('restaurant.unauthorized', 'Unauthorized')}</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3">
          <PageHeader eyebrow={t('restaurant.eyebrow', 'จักรวรรดิ')} title={t('restaurant.admin.title', 'จัดการร้าน — เมนู & สูตร')} icon={<Icon name="inventory" size={18} />} subtitle={t('restaurant.admin.subtitle', 'เมนูเพิ่มได้ไม่จำกัด • สูตรดึงจาก Farm โดยตรง + สแกนบิลตลาด (เน้นผลิตเอง)')} actions={<Link href="/restaurant" className="text-sm text-sky-400 hover:underline">{t('restaurant.backToPos', '← POS')}</Link>} />
        </header>
        <main className="max-w-6xl mx-auto p-6 space-y-4 w-full">
          {msg && <div className="inset p-3 text-sm text-emerald-300">{msg}</div>}
          {err && <div className="inset p-3 text-sm text-red-400">{err}</div>}

          <div className="card p-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-gray-400">{t('restaurant.restaurantLabel', 'ร้าน')}</label>
              <select value={selected} onChange={e=>setSelected(e.target.value)} className="mt-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm">
                <option value="">{t('restaurant.selectPlaceholder', '— เลือกร้าน —')}</option>
                {restaurants.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="flex gap-2 items-end">
              <div>
                <label className="text-xs text-gray-400">{t('restaurant.admin.cameraLabel', 'ผูกกล้องหน้าร้าน (cameraId)')}</label>
                <input value={cameraId} onChange={e=>setCameraId(e.target.value)} placeholder={t('restaurant.admin.cameraPlaceholder', 'เช่น Camera.id จาก /sensors')} className="mt-1 w-64 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm" />
              </div>
              <button onClick={bindCamera} className="px-3 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm">{t('restaurant.admin.bindCamera', 'ผูกกล้อง')}</button>
            </div>
            <div className="ml-auto text-xs text-gray-500">{t('restaurant.admin.ownerNote', 'เจ้าของร้านเพิ่มได้ / superadmin เห็นรายจ่ายทั้งหมด')}</div>
          </div>

          {!selected ? <div className="text-sm text-gray-500 py-8 text-center">{t('restaurant.selectFirst', 'เลือกร้านก่อน')}</div> : (
            <>
              <div className="card p-4">
                <h3 className="font-bold mb-2">{t('restaurant.admin.addMenuTitle', 'เพิ่มเมนู')}</h3>
                <div className="flex flex-wrap gap-2">
                  <input value={name} onChange={e=>setName(e.target.value)} placeholder={t('restaurant.admin.menuNamePlaceholder', 'ชื่อเมนู เช่น ข้าวผัดกระเพรา')} className="flex-1 min-w-60 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm" />
                  <input value={price} onChange={e=>setPrice(e.target.value)} placeholder={t('restaurant.admin.pricePlaceholder', 'ราคา บาท')} type="number" className="w-32 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm" />
                  <select value={category} onChange={e=>setCategory(e.target.value)} className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm">
                    <option value="FOOD">FOOD</option><option value="DRINK">DRINK</option><option value="DESSERT">DESSERT</option>
                  </select>
                  <button onClick={createMenu} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-bold">{t('restaurant.admin.addButton', '+ เพิ่ม')}</button>
                </div>
                <p className="text-xs text-gray-500 mt-2">{t('restaurant.admin.menuNote', 'เมนูเพิ่มได้ไม่จำกัด — สูตรจะดึงวัตถุดิบจาก Inventory/Farm')}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {menus.map(m=>(
                  <div key={m.id} className="card p-4 space-y-2">
                    <div className="flex justify-between"><span className="font-bold">{m.name}</span><span className="text-sm text-emerald-400">{m.priceTHB} {t('restaurant.baht', 'บาท')}</span></div>
                    <div className="text-xs text-gray-500">{t('restaurant.admin.ingredientsCount', '{n} วัตถุดิบ', { n: m.recipes?.length || 0 })} {m.recipes?.some((r:any)=>r.isSelfProduced)?t('restaurant.admin.selfProducedTag', '• เน้นผลิตเอง'):''}</div>
                    {editing===m.id ? (
                      <div className="space-y-2">
                        {recipeLines.map((l,i)=>(
                          <div key={i} className="flex gap-2">
                            <input value={l.farmCrop} onChange={e=>{ const a=[...recipeLines]; a[i].farmCrop=e.target.value; setRecipeLines(a); }} placeholder={t('restaurant.admin.cropPlaceholder', 'ชื่อพืช/วัตถุดิบ (เช่น ข้าวหอม)')} className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
                            <select value={l.inventoryItemId||""} onChange={e=>{ const a=[...recipeLines]; a[i].inventoryItemId=e.target.value; setRecipeLines(a); }} className="w-40 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs">
                              <option value="">{t('restaurant.admin.fromStock', '— เลือกจากสต็อก —')}</option>
                              {inventory.map((it:any)=><option key={it.id} value={it.id}>{it.name} ({it.quantity}{it.unit})</option>)}
                            </select>
                            <input value={l.qtyGram} onChange={e=>{ const a=[...recipeLines]; a[i].qtyGram=e.target.value; setRecipeLines(a); }} type="number" placeholder={t('restaurant.admin.gramPlaceholder', 'กรัม')} className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
                            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={l.isSelfProduced} onChange={e=>{ const a=[...recipeLines]; a[i].isSelfProduced=e.target.checked; setRecipeLines(a); }} />{t('restaurant.admin.selfProduced', 'ผลิตเอง')}</label>
                            <button onClick={()=>setRecipeLines(recipeLines.filter((_,j)=>j!==i))} className="text-red-400 text-xs">{t('restaurant.admin.removeRow', 'ลบ')}</button>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <button onClick={()=>setRecipeLines([...recipeLines,{farmCrop:"",qtyGram:50,isSelfProduced:true}])} className="text-xs px-2 py-1 bg-gray-800 rounded">{t('restaurant.admin.addRow', '+ แถว')}</button>
                          <button onClick={()=>saveRecipe(m.id)} className="text-xs px-3 py-1 bg-emerald-600 rounded font-bold">{t('restaurant.admin.saveRecipe', 'บันทึกสูตร')}</button>
                          <button onClick={()=>setEditing(null)} className="text-xs px-3 py-1 bg-gray-700 rounded">{t('restaurant.admin.cancel', 'ยกเลิก')}</button>
                        </div>
                        <p className="text-[11px] text-gray-500">{t('restaurant.admin.recipeHint', 'ถ้าติ๊กผลิตเอง ระบบจะเช็คสต็อก Farm ก่อนขาย — ถ้าไม่พอจะบล็อกเมนู (เนื้อหมูให้เอาติ๊กออก ซื้อตลาดได้)')}</p>
                      </div>
                    ) : (
                      <div>
                        {m.recipes?.length? <ul className="text-xs text-gray-400 list-disc ml-4">{m.recipes.map((r:any,i:number)=><li key={i}>{r.farmCrop||r.inventoryItemId} {r.qtyGram}g {r.isSelfProduced?t('restaurant.admin.selfTag', '(ผลิตเอง)'):t('restaurant.admin.buyTag', '(ซื้อได้)')}</li>)}</ul> : <div className="text-xs text-gray-600">{t('restaurant.admin.noRecipe', 'ยังไม่มีสูตร')}</div>}
                        <button onClick={()=>{ setEditing(m.id); setRecipeLines(m.recipes?.length?m.recipes.map((r:any)=>({farmCrop:r.farmCrop||"",inventoryItemId:r.inventoryItemId||"",qtyGram:r.qtyGram,isSelfProduced:r.isSelfProduced})): [{farmCrop:"",qtyGram:100,isSelfProduced:true}]); }} className="mt-2 text-xs px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded">{t('restaurant.admin.editRecipe', 'แก้ไขสูตร')}</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
