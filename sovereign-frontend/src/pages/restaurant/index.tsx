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

interface Restaurant { id: string; name: string; cameraId?: string | null; status: string; }
interface MenuItem { id: string; restaurantId: string; name: string; priceTHB: number; category: string; isActive: boolean; recipes?: any[]; canMake?: boolean; missing?: string[]; }
interface Customer { id: string; name: string; phone?: string; points: number; tier: string; }
interface OrderLine { menuId: string; qty: number; name: string; priceTHB: number; }

export default function RestaurantPage() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cart, setCart] = useState<OrderLine[]>([]);
  const [tableNo, setTableNo] = useState("");
  const [orderType, setOrderType] = useState<"DINE_IN"|"TAKEAWAY">("DINE_IN");
  const [customerId, setCustomerId] = useState("");
  const [payment, setPayment] = useState<"CASH"|"PROMPTPAY">("CASH");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [showFace, setShowFace] = useState(false);
  const [faceName, setFaceName] = useState("");
  const [facePhone, setFacePhone] = useState("");
  const [faceImage, setFaceImage] = useState("");

  const load = async () => {
    try {
      const [rRes, cRes] = await Promise.all([
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/customers`),
      ]);
      if (rRes.ok) { const d = await rRes.json(); setRestaurants(Array.isArray(d) ? d : []); if (d[0] && !selected) setSelected(d[0].id); }
      if (cRes.ok) { const d = await cRes.json(); setCustomers(Array.isArray(d) ? d : []); }
    } catch {}
    setLoading(false);
  };
  const loadMenus = async (rid: string) => {
    if (!rid) return;
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/menus/available?restaurantId=${rid}`);
    if (res.ok) setMenus(asArray(await res.json()));
    else {
      const r2 = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/menus?restaurantId=${rid}`);
      if (r2.ok) setMenus(asArray(await r2.json()));
    }
  };
  useEffect(()=>{ if(isAuthenticated) load(); },[isAuthenticated]);
  useEffect(()=>{ if(selected) loadMenus(selected); },[selected]);

  const addToCart = (m: MenuItem) => {
    setCart((c)=>{
      const f=c.find(x=>x.menuId===m.id);
      if(f) return c.map(x=>x.menuId===m.id?{...x,qty:x.qty+1}:x);
      return [...c,{menuId:m.id,name:m.name,priceTHB:m.priceTHB,qty:1}];
    });
  };
  const total = cart.reduce((s,c)=>s+c.priceTHB*c.qty,0);
  const pointsEarned = Math.floor(total/20);

  const createRestaurant = async () => {
    const name = window.prompt(t('restaurant.pos.promptName', 'ชื่อร้าน?'));
    if(!name) return;
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});
    if(res.ok){ setMsg(t('restaurant.pos.created', 'สร้างร้านแล้ว')); load(); } else setErr(t('restaurant.pos.createFailed', 'สร้างไม่สำเร็จ'));
  };

  const enrollFace = async () => {
    if(!faceName || !faceImage) return setErr(t('restaurant.pos.face.needNameImage', 'ใส่ชื่อและรูป (base64) ก่อน'));
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/customers/face-enroll`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:faceName,phone:facePhone,imageBase64:faceImage,consentFace:true})});
    const d = await res.json();
    if(res.ok){ setMsg(t('restaurant.pos.face.enrolled', 'สมัครลูกค้าใบหน้า {name} สำเร็จ', { name: faceName })); setFaceName(""); setFacePhone(""); setFaceImage(""); load(); } else setErr(d.error||t('restaurant.pos.face.failed', 'enroll ไม่สำเร็จ'));
  };

  const placeOrder = async () => {
    if(!selected) return setErr(t('restaurant.selectFirst', 'เลือกร้านก่อน'));
    if(cart.length===0) return setErr(t('restaurant.pos.cartEmptyErr', 'ตะกร้าว่าง'));
    setErr(""); setMsg("");
    try{
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/orders`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({restaurantId:selected, items: cart.map(c=>({menuId:c.menuId,qty:c.qty})), tableNo: tableNo||null, type:orderType, customerId: customerId||null})});
      const data = await res.json();
      if(!res.ok) throw new Error(data.error||t('restaurant.pos.orderFailed', 'สร้างออเดอร์ไม่สำเร็จ'));
      // pay immediately
      const payRes = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/orders/${data.id}/pay`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({payment})});
      const payData = await payRes.json();
      if(!payRes.ok) throw new Error(payData.error||t('restaurant.pos.payFailed', 'จ่ายไม่สำเร็จ'));
      setMsg(t('restaurant.pos.orderCreated', 'ออเดอร์ {no} สำเร็จ {total} บาท {payment}{points}', { no: data.orderNo, total, payment, points: pointsEarned ? ` +${pointsEarned} ${t('restaurant.pos.pointsUnit', 'แต้ม')}` : '' }));
      setCart([]); setTableNo("");
      loadMenus(selected);
      load();
    }catch(e:any){ setErr(e.message); }
  };

  if(!isHydrated) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t('restaurant.loading', 'กำลังโหลด...')}</div>;
  if(!isAuthenticated) return <div className="text-white p-8">{t('restaurant.unauthorized', 'Unauthorized')}</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3">
          <PageHeader eyebrow={t('restaurant.eyebrow', 'จักรวรรดิ')} title={t('restaurant.pos.title', 'ร้านอาหาร — POS จักรวรรดิ')} icon={<Icon name="inventory" size={18} />} subtitle={t('restaurant.pos.subtitle', 'Farm → Inventory → สูตร (เน้นผลิตเอง) → ขาย เงินสด/PromptPay + ใบหน้าแต้ม')} actions={<Link href="/farm" className="text-sm text-sky-400 hover:underline">{t('restaurant.backToFarm', '← ฟาร์ม')}</Link>} />
        </header>
        <main className="max-w-7xl mx-auto p-6 space-y-4 w-full">
          {msg && <div className="inset p-3 text-sm text-emerald-300 border-emerald-700">{msg}</div>}
          {err && <div className="inset p-3 text-sm text-red-400 border-red-700">{err}</div>}

          {/* ร้าน + กล้อง */}
          <div className="card panel-glow p-4 flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-60">
              <label className="text-xs text-gray-400">{t('restaurant.restaurantLabel', 'ร้าน')}</label>
              <div className="flex gap-2 mt-1">
                <select value={selected} onChange={e=>setSelected(e.target.value)} className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm">
                  <option value="">{t('restaurant.selectPlaceholder', '— เลือกร้าน —')}</option>
                  {restaurants.map(r=><option key={r.id} value={r.id}>{r.name} {r.cameraId?`[cam:${r.cameraId.slice(0,6)}]`:''}</option>)}
                </select>
                <button onClick={createRestaurant} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm">{t('restaurant.pos.addRestaurant', '+ ร้าน')}</button>
              </div>
            </div>
            <div className="flex gap-2 items-end">
              <select value={orderType} onChange={e=>setOrderType(e.target.value as any)} className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm">
                <option value="DINE_IN">{t('restaurant.pos.dineIn', 'นั่งกิน')}</option><option value="TAKEAWAY">{t('restaurant.pos.takeaway', 'กลับบ้าน')}</option>
              </select>
              <input value={tableNo} onChange={e=>setTableNo(e.target.value)} placeholder={t('restaurant.pos.tablePlaceholder', 'โต๊ะ (เช่น A1)')} className="w-28 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm" />
              <select value={customerId} onChange={e=>setCustomerId(e.target.value)} className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm">
                <option value="">{t('restaurant.pos.walkInCustomer', 'ลูกค้าทั่วไป')}</option>
                {customers.map(c=><option key={c.id} value={c.id}>{c.name} ({c.points}{t('restaurant.pos.pointsUnit', 'แต้ม')})</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* เมนู */}
            <div className="lg:col-span-2 card p-4 space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold glow-text">{selected ? t('restaurant.pos.menuCount', 'เมนู ({n})', { n: menus.length }) : t('restaurant.pos.menuTitle', 'เมนู')}</h3>
                <button onClick={()=>selected&&loadMenus(selected)} className="text-xs px-2 py-1 bg-gray-800 rounded">{t('restaurant.refresh', 'รีเฟรช')}</button>
              </div>
              {!selected ? <div className="text-sm text-gray-500 py-8 text-center">{t('restaurant.selectFirst', 'เลือกร้านก่อน')}</div> :
                menus.length===0 ? <div className="text-sm text-gray-500 py-8 text-center">{t('restaurant.pos.noMenus', 'ยังไม่มีเมนู — ไปเพิ่มที่ /restaurant/admin')}</div> :
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {menus.map(m=>(
                    <button key={m.id} onClick={()=>m.canMake===false?null:addToCart(m)} disabled={m.canMake===false} className={`p-3 rounded-xl border text-left ${m.canMake===false?'bg-gray-800 border-red-900 opacity-60':'bg-gray-900 border-gray-700 hover:border-emerald-600'}`}>
                      <div className="font-bold text-sm">{m.name}</div>
                      <div className="text-xs text-gray-400">{m.category} • {m.priceTHB} {t('restaurant.baht', 'บาท')}</div>
                      {m.canMake===false && <div className="text-[11px] text-red-400 mt-1">{t('restaurant.pos.notEnough', 'ของไม่พอ: {items}', { items: m.missing?.join(", ") || '' })}</div>}
                      {m.canMake!==false && <div className="text-[11px] text-emerald-400 mt-1">{t('restaurant.pos.addToCart', '+ เพิ่มลงตะกร้า')}</div>}
                    </button>
                  ))}
                </div>
              }
              <div className="pt-2 border-t border-gray-800 flex gap-2">
                <Link href="/restaurant/admin" className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg">{t('restaurant.pos.manageMenu', 'จัดการเมนู/สูตร')}</Link>
                <Link href="/inventory" className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg">{t('restaurant.pos.viewInventory', 'ดูวัตถุดิบ')}</Link>
                <Link href="/farm" className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg">{t('restaurant.pos.farmHarvest', 'ฟาร์ม → เก็บเกี่ยว')}</Link>
              </div>
            </div>

            {/* ตะกร้า + จ่าย */}
            <div className="card p-4 space-y-3 panel-cyan">
              <h3 className="text-sm font-bold flex items-center gap-1"><Icon name="inventory" size={14}/> {t('restaurant.pos.cartCount', 'ตะกร้า ({n})', { n: cart.length })}</h3>
              {cart.length===0 ? <div className="text-sm text-gray-500 py-4 text-center">{t('restaurant.pos.cartEmpty', 'ยังไม่มีรายการ')}</div> :
                <div className="space-y-2">
                  {cart.map(c=>(
                    <div key={c.menuId} className="flex justify-between items-center bg-gray-900 rounded-lg px-3 py-2 text-sm">
                      <div><div className="font-bold">{c.name}</div><div className="text-xs text-gray-400">{c.priceTHB} x {c.qty}</div></div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold">{c.priceTHB*c.qty}฿</span>
                        <button onClick={()=>setCart(cart.filter(x=>x.menuId!==c.menuId))} className="text-red-400"><Icon name="trash" size={12}/></button>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between font-bold text-lg border-t border-gray-700 pt-2"><span>{t('restaurant.pos.total', 'รวม')}</span><span>{total} {t('restaurant.baht', 'บาท')}</span></div>
                  {pointsEarned>0 && <div className="text-xs text-amber-300">{t('restaurant.pos.pointsHint', '+{n} แต้ม (20฿=1แต้ม)', { n: pointsEarned })}</div>}
                  <div className="flex gap-2">
                    <button onClick={()=>setPayment("CASH")} className={`flex-1 py-2 rounded-lg text-sm font-bold ${payment==="CASH"?"bg-emerald-600":"bg-gray-800"}`}>{t('restaurant.pos.cash', 'เงินสด')}</button>
                    <button onClick={()=>setPayment("PROMPTPAY")} className={`flex-1 py-2 rounded-lg text-sm font-bold ${payment==="PROMPTPAY"?"bg-sky-600":"bg-gray-800"}`}>{t('restaurant.pos.promptpay', 'PromptPay QR')}</button>
                  </div>
                  <button onClick={placeOrder} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-bold">{t('restaurant.pos.payButton', 'จ่ายเงิน / ปิดบิล')}</button>
                  <button onClick={()=>setCart([])} className="w-full py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs">{t('restaurant.pos.clearCart', 'ล้างตะกร้า')}</button>
                </div>
              }

              {/* ใบหน้าแต้ม */}
              <div className="border-t border-gray-800 pt-3">
                <button onClick={()=>setShowFace(!showFace)} className="text-xs text-sky-400 hover:underline">{showFace?t('restaurant.pos.face.toggleHide', 'ซ่อน'):t('restaurant.pos.face.toggleShow', 'สมัครลูกค้าใบหน้า (ไม่ใช้บัตร)')}</button>
                {showFace && (
                  <div className="mt-2 space-y-2 bg-gray-900 rounded-lg p-3">
                    <input value={faceName} onChange={e=>setFaceName(e.target.value)} placeholder={t('restaurant.pos.face.namePlaceholder', 'ชื่อลูกค้า')} className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                    <input value={facePhone} onChange={e=>setFacePhone(e.target.value)} placeholder={t('restaurant.pos.face.phonePlaceholder', 'เบอร์ (ถ้ามี)')} className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                    <input value={faceImage} onChange={e=>setFaceImage(e.target.value)} placeholder={t('restaurant.pos.face.imagePlaceholder', 'รูป base64 (ถ่ายจากกล้อง)')} className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                    <label className="text-xs flex items-center gap-1"><input type="checkbox" checked /> {t('restaurant.pos.face.consent', 'ยินยอมใช้ใบหน้า (PDPA)')}</label>
                    <button onClick={enrollFace} className="w-full py-1.5 bg-sky-600 hover:bg-sky-500 rounded text-xs font-bold">{t('restaurant.pos.face.enrollButton', 'ลงทะเบียนใบหน้า + เก็บแต้ม')}</button>
                    <p className="text-[11px] text-gray-500">{t('restaurant.pos.face.note', 'เห็นหน้า → เข้าถึงแต้ม/ประวัติทันที ไม่ต้องใช้บัตร')}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
