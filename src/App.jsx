import { useState, useEffect } from "react";

// ── LIFF SDK (ห้องครัว) ──────────────────────────────────────
// ⚠️  ใส่ค่าจริงตรงนี้เมื่อ deploy จริง
const KITCHEN_LIFF_ID = "YOUR_KITCHEN_LIFF_ID";
const STAFF_USER_IDS  = []; // เช่น ["Uabc123", "Uxyz789"] — ถ้าว่างจะผ่านหมด (dev mode)

let _kitchenLiffReady = false;
let _kitchenProfile   = null; // { userId, displayName, pictureUrl }
let _isStaff          = false;

const getKitchenLiff = () => window.liff;

const initKitchenLiff = async () => {
  const liff = getKitchenLiff();
  if (!liff || _kitchenLiffReady) return;
  try {
    await liff.init({
      liffId: KITCHEN_LIFF_ID,
      withLoginOnExternalBrowser: true,
    });
    _kitchenLiffReady = true;

    if (!liff.isLoggedIn()) {
      liff.login(); // บังคับ login ทันที — ห้องครัวต้อง login เสมอ
      return;
    }

    _kitchenProfile = await liff.getProfile();
    // ตรวจสอบว่าเป็นพนักงานหรือไม่
    _isStaff = STAFF_USER_IDS.length === 0 // ถ้ายังไม่ได้ตั้ง whitelist ให้ผ่านหมด (dev mode)
      || STAFF_USER_IDS.includes(_kitchenProfile.userId);
  } catch (e) {
    console.warn("Kitchen LIFF init failed (dev mode ok):", e.message);
    _kitchenLiffReady = true;
    _isStaff = true; // dev mode ผ่านหมด
  }
};

// ── Messaging API helpers ─────────────────────────────────────
// ส่งแจ้งสถานะออเดอร์กลับไปหาลูกค้าโดยตรง
const pushStatusToCustomer = async (userId, orderInfo) => {
  if (!userId) return;
  try {
    await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, messages: [orderInfo] }),
    });
  } catch (e) {
    console.error("push status error:", e);
  }
};

// สร้าง Flex Message แจ้งสถานะอาหาร
const makeStatusFlex = (order, status) => {
  const statusMap = {
    preparing: { emoji:"🔥", label:"กำลังปรุง", color:"#2563EB", desc:"พนักงานกำลังเตรียมอาหารให้ท่าน" },
    served:    { emoji:"✅", label:"เสิร์ฟแล้ว", color:"#16A34A", desc:"อาหารมาถึงโต๊ะแล้ว ทานให้อร่อยนะคะ 🍖" },
  };
  const s = statusMap[status];
  if (!s) return null;
  return {
    type: "flex",
    altText: `${s.emoji} ออเดอร์ #${order.id} ${s.label}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: s.color, paddingAll: "16px",
        contents: [
          { type:"text", text:`${s.emoji} ${s.label}`, color:"#fff", size:"xl", weight:"bold" },
          { type:"text", text:`ออเดอร์ #${order.id} · โต๊ะ ${order.table}`, color:"#ffffff99", size:"sm", margin:"sm" },
        ]
      },
      body: {
        type:"box", layout:"vertical", paddingAll:"16px", spacing:"sm",
        contents: [
          { type:"text", text:s.desc, size:"sm", color:"#555", wrap:true },
          { type:"separator", margin:"md" },
          ...order.items.map(it => ({
            type:"box", layout:"horizontal",
            contents:[
              { type:"text", text:`• ${it.name}`, flex:4, size:"sm", color:"#333", wrap:true },
              { type:"text", text:`×${it.qty}`, flex:1, size:"sm", color:"#8B2635", weight:"bold", align:"end" },
            ]
          })),
        ]
      },
      footer: {
        type:"box", layout:"vertical", paddingAll:"12px",
        contents:[{
          type:"text", text:"ขาหมูนาย ต. 🍖", size:"sm", color:"#888", align:"center"
        }]
      }
    }
  };
};

// ── สีและธีม (Light Mode) ─────────────────────────────────────
const K = {
  bg:     "#F5F5F5",
  card:   "#FFFFFF",
  card2:  "#F9F9F9",
  border: "#E5E5E5",
  red:    "#DC2626",
  gold:   "#D97706",
  green:  "#16A34A",
  blue:   "#2563EB",
  orange: "#EA580C",
  purple: "#7C3AED",
  text:   "#111111",
  muted:  "#888888",
  dim:    "#BBBBBB",
  shadow: "rgba(0,0,0,0.08)",
};

// ── MENU สำหรับเพิ่มรายการ ─────────────────────────────────────
const MENU_ITEMS = [
  { id:1,  name:"ขาหมูพะโล้เตาถ่าน", cat:"ขาหมู",        price:400, emoji:"🍖" },
  { id:2,  name:"ข้าวขาหมู",          cat:"ข้าว",         price:60,  emoji:"🍚" },
  { id:3,  name:"ขาหมูผัดผัก",        cat:"ขาหมู",        price:120, emoji:"🥬" },
  { id:4,  name:"กาแฟขี้ชะมด",        cat:"กาแฟ",         price:199, emoji:"☕" },
  { id:5,  name:"กาแฟลาเต้",          cat:"กาแฟ",         price:75,  emoji:"🧋" },
  { id:6,  name:"ไชเท้าดอง",          cat:"เครื่องเคียง", price:20,  emoji:"🥒" },
  { id:7,  name:"ไข่เป็ดต้ม",         cat:"เครื่องเคียง", price:10,  emoji:"🥚" },
  { id:8,  name:"น้ำเปล่า",           cat:"เครื่องดื่ม",  price:10,  emoji:"💧" },
];

const calcTotal = (items) => items.reduce((s, it) => s + it.price * it.qty, 0);

// ── Shared Order Store (sync กับหน้าร้าน App.jsx) ────────────
const ORDER_KEY = "kmt_shared_orders";
const OID_KEY   = "kmt_shared_oid";

const _getOrders = () => {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY)) || []; } catch { return []; }
};
const _saveOrders = (orders) => {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(orders)); } catch {}
};
const _getOid = () => {
  try { return parseInt(localStorage.getItem(OID_KEY) || "1", 10); } catch { return 1; }
};
const _saveOid = (n) => {
  try { localStorage.setItem(OID_KEY, String(n)); } catch {}
};

// แปลง cart items จาก App.jsx format → kitchen format
const normalizeItems = (items) =>
  items.map(e => e.item
    ? { id: e.item.id, name: e.item.name + (e.opts?.length ? ` (${e.opts.map(o=>o.label).join(",")})` : ""), qty: e.qty, price: e.unitPrice }
    : e
  );

// แปลง order จาก App.jsx format → kitchen format
const normalizeOrder = (o) => ({
  ...o,
  items: normalizeItems(o.items || []),
  time: o.time ? new Date(o.time) : new Date(),
});

const INITIAL_ORDERS = [
  { id:101, table:"2",        items:[{id:1,name:"ขาหมูพะโล้เตาถ่าน",qty:1,price:400},{id:2,name:"ข้าวขาหมู",qty:2,price:60},{id:6,name:"ไชเท้าดอง",qty:1,price:20}], status:"pending",  time:new Date(Date.now()-5*60000),  pay:"cash",      note:"ไม่ใส่ผัก" },
  { id:102, table:"5",        items:[{id:4,name:"กาแฟขี้ชะมด",qty:2,price:199},{id:2,name:"ข้าวขาหมู",qty:1,price:60}],                                               status:"preparing", time:new Date(Date.now()-12*60000), pay:"promptpay", note:"" },
  { id:103, table:"1",        items:[{id:3,name:"ขาหมูผัดผัก",qty:1,price:120},{id:5,name:"กาแฟลาเต้",qty:1,price:75}],                                               status:"served",    time:new Date(Date.now()-25*60000), pay:"cash",      note:"" },
  { id:104, table:"Delivery", items:[{id:1,name:"ขาหมูพะโล้เตาถ่าน",qty:2,price:400},{id:2,name:"ข้าวขาหมู",qty:2,price:60}],                                         status:"pending",  time:new Date(Date.now()-3*60000),  pay:"transfer",  note:"🛵 จัดส่ง" },
].map(o => ({ ...o, total: calcTotal(o.items) }));

const STOCK_ITEMS = [
  { id:1, name:"ขาหมู",          unit:"กก.",  qty:15, minQty:5,  emoji:"🍖" },
  { id:2, name:"พะโล้เครื่องเทศ",unit:"ชุด",  qty:8,  minQty:3,  emoji:"🌿" },
  { id:3, name:"ข้าวสวย",        unit:"กก.",  qty:20, minQty:8,  emoji:"🍚" },
  { id:4, name:"กาแฟขี้ชะมด",    unit:"กก.",  qty:2,  minQty:1,  emoji:"☕" },
  { id:5, name:"ไชเท้า",         unit:"กก.",  qty:4,  minQty:5,  emoji:"🥒" },
  { id:6, name:"ผักกาดดอง",      unit:"กก.",  qty:3,  minQty:2,  emoji:"🥬" },
  { id:7, name:"ไข่เป็ด",        unit:"ฟอง",  qty:48, minQty:24, emoji:"🥚" },
  { id:8, name:"นมสด",           unit:"ลิตร", qty:5,  minQty:3,  emoji:"🥛" },
];

const CLOSING_STEPS = [
  { id:1,  zone:"ครัว",         task:"ปิดเตาไฟทุกหัว",            icon:"🔥", critical:true  },
  { id:2,  zone:"ครัว",         task:"ล้างอุปกรณ์ทำอาหารทั้งหมด", icon:"🫧", critical:true  },
  { id:3,  zone:"ครัว",         task:"เก็บวัตถุดิบเข้าตู้เย็น",    icon:"🧊", critical:true  },
  { id:4,  zone:"ครัว",         task:"ทำความสะอาดเตา/ครัว",        icon:"🧹", critical:false },
  { id:5,  zone:"ครัว",         task:"เช็คสต็อกวัตถุดิบพรุ่งนี้",  icon:"📋", critical:false },
  { id:6,  zone:"บาร์",         task:"ล้างแก้ว/อุปกรณ์กาแฟ",       icon:"☕", critical:true  },
  { id:7,  zone:"บาร์",         task:"เก็บเมล็ดกาแฟ/นม",           icon:"🥛", critical:true  },
  { id:8,  zone:"ร้าน",         task:"ล้างโต๊ะ/เก้าอี้",           icon:"🪑", critical:false },
  { id:9,  zone:"ร้าน",         task:"กวาด/ถูพื้น",                icon:"🧹", critical:false },
  { id:10, zone:"ร้าน",         task:"นับเงินในกล่อง",              icon:"💰", critical:true  },
  { id:11, zone:"ระบบ",         task:"บันทึกยอดขายประจำวัน",        icon:"📊", critical:true  },
  { id:12, zone:"ระบบ",         task:"ปิดแอปสั่งอาหาร",            icon:"📱", critical:false },
  { id:13, zone:"ความปลอดภัย",  task:"ล็อคประตู/หน้าต่าง",         icon:"🔒", critical:true  },
  { id:14, zone:"ความปลอดภัย",  task:"ปิดไฟทุกจุด",                icon:"💡", critical:true  },
  { id:15, zone:"ความปลอดภัย",  task:"ปิดแอร์ทุกตัว",              icon:"❄️", critical:false },
];

const WEEKLY_SALES  = [
  {day:"จ.",  revenue:4800,  orders:12},
  {day:"อ.",  revenue:5200,  orders:15},
  {day:"พ.",  revenue:3900,  orders:10},
  {day:"พฤ.", revenue:6100,  orders:18},
  {day:"ศ.",  revenue:7400,  orders:22},
  {day:"ส.",  revenue:8900,  orders:27},
  {day:"อา.", revenue:9200,  orders:28},
];
const MONTHLY_SALES = [
  {month:"ม.ค.",  revenue:180000},
  {month:"ก.พ.",  revenue:165000},
  {month:"มี.ค.", revenue:192000},
  {month:"เม.ย.", revenue:175000},
  {month:"พ.ค.",  revenue:210000},
];

const timeAgo = (date) => {
  const mins = Math.floor((Date.now()-date)/60000);
  if (mins<1)  return "เพิ่งเข้ามา";
  if (mins<60) return `${mins} นาทีที่แล้ว`;
  return `${Math.floor(mins/60)} ชั่วโมงที่แล้ว`;
};

const STATUS_COLOR = {pending:K.orange, preparing:K.blue, served:K.green};
const STATUS_LABEL = {pending:"รอดำเนินการ", preparing:"กำลังทำ", served:"เสิร์ฟแล้ว"};
const STATUS_EMOJI = {pending:"⏳", preparing:"🔥", served:"✅"};

// ── Badge ──────────────────────────────────────────────────────
function Badge({color, children}) {
  return (
    <span style={{background:`${color}18`, color, fontSize:12.1, fontWeight:800,
      padding:"3px 11px", borderRadius:20, border:`1px solid ${color}44`}}>
      {children}
    </span>
  );
}

// ── Header ─────────────────────────────────────────────────────
function Header({title, subtitle, right}) {
  return (
    <div style={{padding:"20px 18px 14px", borderBottom:`1.5px solid ${K.border}`,
      display:"flex", justifyContent:"space-between", alignItems:"flex-start",
      background:K.card, boxShadow:`0 2px 8px ${K.shadow}`}}>
      <div>
        <div style={{fontSize:11, color:K.muted, fontWeight:700, letterSpacing:2,
          textTransform:"uppercase", marginBottom:4}}>ห้องครัว · ขาหมูนาย ต.</div>
        <h1 style={{fontSize:24.2, fontWeight:900, color:K.text, margin:0, letterSpacing:-0.5}}>{title}</h1>
        {subtitle && <div style={{fontSize:13.2, color:K.muted, marginTop:3}}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

// ── NavBar ─────────────────────────────────────────────────────
function NavBar({tab, setTab}) {
  const tabs = [
    {id:"orders",  label:"ออเดอร์", emoji:"📋"},
    {id:"sales",   label:"ยอดขาย",  emoji:"📊"},
    {id:"stock",   label:"สต็อก",   emoji:"📦"},
    {id:"closing", label:"ปิดร้าน", emoji:"🔒"},
  ];
  return (
    <nav style={{position:"fixed", bottom:0, left:0, right:0,
      background:K.card, borderTop:`1.5px solid ${K.border}`,
      display:"grid", gridTemplateColumns:"repeat(4,1fr)",
      padding:"8px 4px 16px", zIndex:50,
      maxWidth:480, margin:"0 auto",
      boxShadow:`0 -4px 16px ${K.shadow}`}}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{
          background:"none", border:"none", cursor:"pointer",
          display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"6px 0"}}>
          <span style={{fontSize:22, filter:tab===t.id?"none":"grayscale(80%)",
            opacity:tab===t.id?1:0.45, transition:"all .2s"}}>{t.emoji}</span>
          <span style={{fontSize:11, fontWeight:700,
            color:tab===t.id?K.gold:K.muted, letterSpacing:.5, transition:"color .2s"}}>{t.label}</span>
          {tab===t.id && <div style={{width:4, height:4, borderRadius:2, background:K.gold, marginTop:-2}}/>}
        </button>
      ))}
    </nav>
  );
}

// ── EDIT ORDER MODAL ───────────────────────────────────────────
function EditOrderModal({order, onClose, onSave, onCancel}) {
  const [items, setItems] = useState(order.items.map(it => ({...it})));
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const changeQty = (idx, delta) => {
    setItems(prev => {
      const next = prev.map((it, i) => i===idx ? {...it, qty: Math.max(0, it.qty+delta)} : it);
      return next.filter(it => it.qty > 0);
    });
  };

  const newTotal = calcTotal(items);
  const canSave  = items.length > 0;

  return (
    <div style={{position:"fixed", inset:0, zIndex:200, display:"flex", alignItems:"flex-end"}}>
      <div onClick={onClose} style={{position:"absolute", inset:0, background:"rgba(0,0,0,.45)"}}/>
      <div style={{position:"relative", width:"100%", maxWidth:480, margin:"0 auto",
        background:K.card, borderRadius:"24px 24px 0 0", maxHeight:"90vh",
        display:"flex", flexDirection:"column", overflow:"hidden",
        boxShadow:"0 -8px 40px rgba(0,0,0,0.15)"}}>

        {/* Modal header */}
        <div style={{padding:"20px 20px 14px", borderBottom:`1px solid ${K.border}`,
          display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0}}>
          <div>
            <div style={{fontSize:17.6, fontWeight:900, color:K.text}}>
              ✏️ แก้ไขออเดอร์
            </div>
            <div style={{fontSize:13.2, color:K.muted, marginTop:2}}>
              {order.table==="Delivery"?"🛵 Delivery":`โต๊ะ ${order.table}`} · #{order.id}
            </div>
          </div>
          <button onClick={onClose} style={{
            background:K.bg, border:`1px solid ${K.border}`, borderRadius:12,
            width:36, height:36, cursor:"pointer", fontSize:18,
            display:"flex", alignItems:"center", justifyContent:"center", color:K.muted}}>×</button>
        </div>

        {/* Info note */}
        <div style={{margin:"12px 20px 0", padding:"10px 14px", borderRadius:12,
          background:`${K.gold}12`, border:`1px solid ${K.gold}44`,
          fontSize:12.1, color:K.gold, fontWeight:600, lineHeight:1.5}}>
          💡 ปรับจำนวนรายการที่สั่งมาได้ · หากต้องการเพิ่มเมนูใหม่ ให้ลูกค้าสั่งเพิ่มเข้ามาแล้วรวมบิล
        </div>

        {/* Items list */}
        <div style={{flex:1, overflowY:"auto", padding:"14px 20px"}}>
          {items.length === 0 && (
            <div style={{textAlign:"center", padding:"30px 0", color:K.muted}}>
              <div style={{fontSize:36, marginBottom:8}}>🗑️</div>
              <div style={{fontSize:14.3}}>ไม่มีรายการเหลืออยู่</div>
              <div style={{fontSize:12.1, marginTop:6, color:K.red}}>กด "ยกเลิกออเดอร์" เพื่อยกเลิกทั้งบิล</div>
            </div>
          )}

          {items.map((item, idx) => (
            <div key={item.id} style={{display:"flex", alignItems:"center", gap:12,
              padding:"12px 0", borderBottom:`1px solid ${K.border}`}}>
              <div style={{flex:1}}>
                <div style={{fontSize:15.4, fontWeight:700, color:K.text}}>{item.name}</div>
                <div style={{fontSize:13.2, color:K.muted, marginTop:2}}>{item.price}฿ / จาน</div>
              </div>
              {/* Qty control */}
              <div style={{display:"flex", alignItems:"center", gap:8}}>
                <button onClick={() => changeQty(idx,-1)} style={{
                  width:34, height:34, borderRadius:10, border:`1.5px solid ${K.border}`,
                  background:item.qty===1?`${K.red}15`:K.bg, cursor:"pointer",
                  fontSize:18, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center",
                  color:item.qty===1?K.red:K.text}}>
                  {item.qty===1?"🗑":"−"}
                </button>
                <span style={{fontSize:17.6, fontWeight:900, color:K.text, minWidth:24, textAlign:"center"}}>
                  {item.qty}
                </span>
                <button onClick={() => changeQty(idx,+1)} style={{
                  width:34, height:34, borderRadius:10, border:"none",
                  background:K.blue, cursor:"pointer", fontSize:18, fontWeight:700,
                  display:"flex", alignItems:"center", justifyContent:"center", color:"white"}}>+</button>
              </div>
              <div style={{fontSize:15.4, fontWeight:800, color:K.gold, minWidth:50, textAlign:"right"}}>
                {item.price*item.qty}฿
              </div>
            </div>
          ))}
        </div>

        {/* Total & actions */}
        <div style={{padding:"14px 20px 24px", borderTop:`1px solid ${K.border}`,
          background:K.card, flexShrink:0}}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14}}>
            <span style={{fontSize:15.4, color:K.muted, fontWeight:600}}>ยอดรวมใหม่</span>
            <span style={{fontSize:22, fontWeight:900, color:K.red}}>{newTotal.toLocaleString()}฿</span>
          </div>
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10}}>
            <button onClick={() => setShowCancelConfirm(true)} style={{
              padding:"13px 0", borderRadius:14, border:`1.5px solid ${K.red}`,
              background:`${K.red}10`, color:K.red, fontSize:14.3, fontWeight:800, cursor:"pointer"}}>
              🚫 ยกเลิกออเดอร์
            </button>
            <button onClick={() => canSave && onSave(items, newTotal)} disabled={!canSave} style={{
              padding:"13px 0", borderRadius:14, border:"none",
              background:canSave?K.green:"#ccc", color:"white",
              fontSize:14.3, fontWeight:800, cursor:canSave?"pointer":"not-allowed",
              boxShadow:canSave?`0 4px 14px ${K.green}44`:"none"}}>
              ✅ บันทึก
            </button>
          </div>
          <button onClick={onClose} style={{
            width:"100%", padding:"11px 0", borderRadius:14,
            border:`1px solid ${K.border}`, background:"none",
            color:K.muted, fontSize:13.2, fontWeight:700, cursor:"pointer"}}>
            ปิด / ไม่บันทึก
          </button>
        </div>
      </div>

      {/* Cancel confirm sub-modal */}
      {showCancelConfirm && (
        <div style={{position:"absolute", inset:0, background:"rgba(0,0,0,.5)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, padding:24}}>
          <div style={{background:K.card, borderRadius:20, padding:24, width:"100%", maxWidth:340,
            boxShadow:"0 8px 40px rgba(0,0,0,.2)"}}>
            <div style={{textAlign:"center", marginBottom:18}}>
              <div style={{fontSize:44, marginBottom:8}}>🚫</div>
              <div style={{fontSize:17.6, fontWeight:900, color:K.text, marginBottom:6}}>ยืนยันยกเลิกออเดอร์?</div>
              <div style={{fontSize:13.2, color:K.muted, lineHeight:1.6}}>
                {order.table==="Delivery"?"🛵 Delivery":`โต๊ะ ${order.table}`} · ออเดอร์ #{order.id}<br/>
                <span style={{color:K.red, fontWeight:700}}>การยกเลิกไม่สามารถย้อนกลับได้</span>
              </div>
            </div>
            <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}}>
              <button onClick={() => setShowCancelConfirm(false)} style={{
                padding:"13px 0", borderRadius:14, border:`1px solid ${K.border}`,
                background:K.bg, color:K.muted, fontSize:14.3, fontWeight:700, cursor:"pointer"}}>ไม่ยกเลิก</button>
              <button onClick={() => onCancel(order.id)} style={{
                padding:"13px 0", borderRadius:14, border:"none",
                background:K.red, color:"white", fontSize:14.3, fontWeight:800, cursor:"pointer",
                boxShadow:`0 4px 14px ${K.red}44`}}>🚫 ยืนยันยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ORDERS VIEW ────────────────────────────────────────────────
function OrdersView({ pushStatus, makeStatusFlex }) {
  // โหลด orders ครั้งแรก: ถ้า localStorage มีข้อมูลใช้เลย ถ้าไม่มีใช้ demo
  const [orders, setOrders] = useState(() => {
    const stored = _getOrders();
    return stored.length > 0 ? stored.map(normalizeOrder) : INITIAL_ORDERS;
  });
  const [filter, setFilter] = useState("all");
  const [editOrder, setEditOrder] = useState(null);
  const [newOrderAlert, setNewOrderAlert] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // sync กับ localStorage แบบ real-time
  useEffect(() => {
    const sync = () => {
      const stored = _getOrders();
      if (stored.length === 0) return;
      setOrders(prev => {
        const normalized = stored.map(normalizeOrder);
        // ตรวจออเดอร์ใหม่
        const prevIds = new Set(prev.map(o => o.id));
        const newest = normalized.find(o => !prevIds.has(o.id) && o.status === "pending");
        if (newest) {
          setNewOrderAlert({ id: newest.id, table: newest.table });
          setTimeout(() => setNewOrderAlert(null), 3500);
        }
        return normalized;
      });
    };
    const iv = setInterval(sync, 1500);
    const onStorage = (e) => {
      if (e.key === ORDER_KEY) {
        try {
          const stored = JSON.parse(e.newValue) || [];
          const normalized = stored.map(normalizeOrder);
          setOrders(prev => {
            const prevIds = new Set(prev.map(o => o.id));
            const newest = normalized.find(o => !prevIds.has(o.id) && o.status === "pending");
            if (newest) {
              setNewOrderAlert({ id: newest.id, table: newest.table });
              setTimeout(() => setNewOrderAlert(null), 3500);
            }
            return normalized;
          });
        } catch {}
      }
    };
    window.addEventListener("storage", onStorage);
    return () => { clearInterval(iv); window.removeEventListener("storage", onStorage); };
  }, []);

  const bump = (id) => {
    // อัพเดต state ทันที ไม่รอ sync
    setOrders(prev => {
      const updated = prev.map(o => {
        if (o.id !== id) return o;
        const next = o.status==="pending" ? "preparing" : o.status==="preparing" ? "served" : "served";
        const newOrder = {...o, status: next};

        // 🔔 ส่งแจ้งเตือนกลับลูกค้าผ่าน LINE
        if (next === "preparing" || next === "served") {
          const flexMsg = makeStatusFlex?.(newOrder, next);
          if (flexMsg && o.lineUserId) {
            // ถ้ามี lineUserId ของลูกค้าบันทึกไว้ → push โดยตรง
            pushStatus?.(o.lineUserId, flexMsg);
          }
          // Broadcast ด้วยข้อความสั้น (ทุกคนใน OA เห็น)
          const label = next === "preparing" ? "🔥 กำลังปรุงอาหาร" : "✅ เสิร์ฟแล้ว";
          fetch("/api/notify", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ message: `${label}\nออเดอร์ #${id} โต๊ะ ${o.table}` })
          }).catch(()=>{});
        }

        return newOrder;
      });
      // เขียนกลับ localStorage (แปลง Date → string ก่อน)
      const toStore = updated.map(o => ({...o, time: o.time instanceof Date ? o.time.toISOString() : o.time}));
      _saveOrders(toStore);
      return updated;
    });
  };

  const handleSave = (orderId, newItems, newTotal) => {
    setOrders(prev => {
      const updated = prev.map(o => o.id===orderId ? {...o, items:newItems, total:newTotal} : o);
      const toStore = updated.map(o => ({...o, time: o.time instanceof Date ? o.time.toISOString() : o.time}));
      _saveOrders(toStore);
      return updated;
    });
    setEditOrder(null);
    showToast("✅ แก้ไขออเดอร์เรียบร้อย");
  };

  const handleCancel = (orderId) => {
    setOrders(prev => {
      const updated = prev.filter(o => o.id!==orderId);
      const toStore = updated.map(o => ({...o, time: o.time instanceof Date ? o.time.toISOString() : o.time}));
      _saveOrders(toStore);
      return updated;
    });
    setEditOrder(null);
    showToast("🚫 ยกเลิกออเดอร์แล้ว");
  };

  const filtered    = filter==="all" ? orders : orders.filter(o => o.status===filter);
  const pendingCount = orders.filter(o => o.status==="pending").length;

  return (
    <div style={{paddingBottom:90}}>
      <Header
        title="ออเดอร์ทั้งหมด"
        subtitle={`${orders.length} ออเดอร์วันนี้`}
        right={pendingCount>0 && (
          <div style={{background:K.red, color:"white", fontSize:22, fontWeight:900,
            width:40, height:40, borderRadius:20, display:"flex", alignItems:"center",
            justifyContent:"center", animation:"pulse 1.5s infinite",
            boxShadow:`0 4px 12px ${K.red}55`}}>
            {pendingCount}
          </div>
        )}
      />

      {/* Toast */}
      {toast && (
        <div style={{position:"fixed", top:16, left:"50%", transform:"translateX(-50%)",
          background:K.text, color:"white", borderRadius:14, padding:"12px 22px",
          fontSize:14.3, fontWeight:700, zIndex:500, whiteSpace:"nowrap",
          boxShadow:"0 4px 20px rgba(0,0,0,.2)", animation:"fadeIn .3s ease"}}>
          {toast}
        </div>
      )}

      {newOrderAlert && (
        <div style={{margin:"12px 16px 0", background:`${K.green}15`,
          border:`2px solid ${K.green}`, borderRadius:14, padding:"12px 16px",
          display:"flex", alignItems:"center", gap:10, animation:"slideDown .3s ease"}}>
          <span style={{fontSize:26}}>🔔</span>
          <div>
            <div style={{fontWeight:800, color:K.green, fontSize:15.4}}>
              ออเดอร์ใหม่! {newOrderAlert.table === "Delivery 🛵" ? "🛵 Delivery" : `โต๊ะ ${newOrderAlert.table}`}
            </div>
            <div style={{fontSize:12.1, color:K.muted}}>ออเดอร์ #{newOrderAlert.id}</div>
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{display:"flex", gap:8, padding:"14px 16px", overflowX:"auto", scrollbarWidth:"none"}}>
        {[
          {id:"all",       label:"ทั้งหมด",    count:orders.length},
          {id:"pending",   label:"รอ",          count:orders.filter(o=>o.status==="pending").length},
          {id:"preparing", label:"กำลังทำ",     count:orders.filter(o=>o.status==="preparing").length},
          {id:"served",    label:"เสิร์ฟแล้ว",  count:orders.filter(o=>o.status==="served").length},
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            background:filter===f.id?K.text:K.card,
            color:filter===f.id?"white":K.muted,
            border:`1.5px solid ${filter===f.id?K.text:K.border}`,
            borderRadius:20, padding:"7px 16px", fontSize:13.2, fontWeight:700,
            cursor:"pointer", whiteSpace:"nowrap",
            display:"flex", alignItems:"center", gap:6, flexShrink:0}}>
            {f.label}
            {f.count>0 && (
              <span style={{background:filter===f.id?"rgba(255,255,255,.2)":K.bg,
                borderRadius:10, padding:"1px 7px", fontSize:12.1}}>{f.count}</span>
            )}
          </button>
        ))}
      </div>

      <div style={{padding:"0 16px", display:"flex", flexDirection:"column", gap:12}}>
        {filtered.map(order => (
          <div key={order.id} style={{
            background:K.card, borderRadius:18,
            border:`1.5px solid ${order.status==="pending"?K.orange+"66":K.border}`,
            overflow:"hidden",
            boxShadow:order.status==="pending"?`0 4px 20px ${K.orange}22`:`0 2px 8px ${K.shadow}`}}>

            {/* Order header */}
            <div style={{padding:"12px 16px", display:"flex", justifyContent:"space-between",
              alignItems:"center", borderBottom:`1px solid ${K.border}`,
              background:order.status==="pending"?`${K.orange}06`:K.card2}}>
              <div style={{display:"flex", alignItems:"center", gap:10}}>
                <div style={{
                  background:order.table==="Delivery"?`${K.blue}18`:`${K.gold}18`,
                  color:order.table==="Delivery"?K.blue:K.gold,
                  fontWeight:900, fontSize:14.3, padding:"5px 12px", borderRadius:10}}>
                  {order.table==="Delivery"?"🛵 ส่งบ้าน":`โต๊ะ ${order.table}`}
                </div>
                <div style={{fontSize:12.1, color:K.muted}}>{timeAgo(order.time)}</div>
              </div>
              <Badge color={STATUS_COLOR[order.status]}>
                {STATUS_EMOJI[order.status]} {STATUS_LABEL[order.status]}
              </Badge>
            </div>

            {/* Step progress */}
            <div style={{padding:"8px 16px", borderBottom:`1px solid ${K.border}`,
              background:K.card2, display:"flex", alignItems:"center", gap:0}}>
              {[
                {key:"pending",   label:"รอรับ",      emoji:"⏳"},
                {key:"preparing", label:"กำลังทำ",    emoji:"🔥"},
                {key:"served",    label:"เสิร์ฟแล้ว", emoji:"✅"},
              ].map((step, i) => {
                const stepIdx   = ["pending","preparing","served"].indexOf(order.status);
                const thisIdx   = i;
                const isDone    = thisIdx < stepIdx;
                const isCurrent = thisIdx === stepIdx;
                return (
                  <div key={step.key} style={{display:"flex", alignItems:"center", flex:1}}>
                    <div style={{display:"flex", flexDirection:"column", alignItems:"center", flex:1}}>
                      <div style={{
                        width:28, height:28, borderRadius:"50%", marginBottom:3,
                        display:"flex", alignItems:"center", justifyContent:"center", fontSize:14,
                        background: isDone ? K.green : isCurrent ? STATUS_COLOR[order.status] : K.border,
                        color: isDone||isCurrent ? "white" : K.muted,
                        boxShadow: isCurrent ? `0 0 0 3px ${STATUS_COLOR[order.status]}33` : "none",
                        transition:"all .3s"}}>
                        {isDone ? "✓" : step.emoji}
                      </div>
                      <div style={{fontSize:10, fontWeight:700,
                        color: isCurrent ? STATUS_COLOR[order.status] : isDone ? K.green : K.dim,
                        whiteSpace:"nowrap"}}>
                        {step.label}
                      </div>
                    </div>
                    {i < 2 && (
                      <div style={{height:2, width:24, flexShrink:0,
                        background: isDone ? K.green : K.border,
                        transition:"background .3s", marginBottom:14}}/>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Items */}
            <div style={{padding:"12px 16px"}}>
              {order.items.map((item, i) => (
                <div key={i} style={{display:"flex", justifyContent:"space-between",
                  fontSize:14.3, color:K.text, padding:"3px 0"}}>
                  <span>• {item.name}</span>
                  <span style={{color:K.gold, fontWeight:700}}>×{item.qty}</span>
                </div>
              ))}
              {order.note && (
                <div style={{marginTop:8, fontSize:13.2, color:K.orange,
                  background:`${K.orange}12`, borderRadius:8, padding:"6px 10px"}}>
                  📝 {order.note}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{padding:"10px 16px", background:K.bg,
              display:"flex", justifyContent:"space-between", alignItems:"center",
              borderTop:`1px solid ${K.border}`}}>
              <div style={{fontWeight:900, color:K.red, fontSize:17.6}}>
                {order.total.toLocaleString()}฿
              </div>
              <div style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end"}}>
                <span style={{fontSize:12.1, color:K.muted}}>
                  {order.pay==="cash"?"💵 เงินสด":order.pay==="promptpay"?"📱 PromptPay":"🏦 โอน"}
                </span>

                {/* Edit button — always visible except served */}
                {order.status !== "served" && (
                  <button onClick={() => setEditOrder(order)} style={{
                    background:K.card, border:`1.5px solid ${K.border}`,
                    color:K.text, padding:"7px 13px", borderRadius:10,
                    fontSize:13.2, fontWeight:700, cursor:"pointer"}}>
                    ✏️ แก้ไข
                  </button>
                )}

                {order.status!=="served" && (
                  <button onClick={() => bump(order.id)} style={{
                    background: order.status==="pending" ? K.orange : K.green,
                    color:"white", border:"none", borderRadius:12,
                    padding:"8px 16px", fontSize:13.2, fontWeight:800, cursor:"pointer",
                    boxShadow:`0 4px 12px ${order.status==="pending"?K.orange:K.green}44`}}>
                    {order.status==="pending" ? "🔥 รับออเดอร์" : "✅ เสิร์ฟแล้ว"}
                  </button>
                )}
                {order.status==="served" && (
                  <span style={{fontSize:13.2, color:K.green, fontWeight:700}}>เสร็จ ✓</span>
                )}
              </div>
            </div>
          </div>
        ))}

        {filtered.length===0 && (
          <div style={{textAlign:"center", padding:"60px 24px", color:K.muted}}>
            <div style={{fontSize:48, marginBottom:12}}>✨</div>
            <div style={{fontSize:16.5, fontWeight:700}}>ไม่มีออเดอร์ในหมวดนี้</div>
          </div>
        )}
      </div>

      {editOrder && (
        <EditOrderModal
          order={editOrder}
          onClose={() => setEditOrder(null)}
          onSave={(items, total) => handleSave(editOrder.id, items, total)}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}

// ── SALES VIEW ─────────────────────────────────────────────────
function SalesView() {
  const [mode, setMode] = useState("daily");
  const maxRev = Math.max(...WEEKLY_SALES.map(d=>d.revenue));
  const maxMon = Math.max(...MONTHLY_SALES.map(d=>d.revenue));
  const todayRev = WEEKLY_SALES[WEEKLY_SALES.length-1].revenue;
  const todayOrd = WEEKLY_SALES[WEEKLY_SALES.length-1].orders;
  const weekTotal = WEEKLY_SALES.reduce((s,d)=>s+d.revenue,0);

  return (
    <div style={{paddingBottom:90}}>
      <Header title="ยอดขาย" subtitle="ข้อมูลการขายสด"/>

      <div style={{padding:"16px 16px 0", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}}>
        {[
          {label:"วันนี้",       value:`฿${todayRev.toLocaleString()}`,        sub:`${todayOrd} ออเดอร์`,  color:K.gold,   emoji:"🌟"},
          {label:"สัปดาห์นี้",  value:`฿${(weekTotal/1000).toFixed(1)}K`,      sub:"7 วันที่ผ่านมา",       color:K.green,  emoji:"📈"},
          {label:"เฉลี่ย/บิล",  value:`฿${Math.round(todayRev/todayOrd)}`,     sub:"วันนี้",               color:K.blue,   emoji:"💳"},
          {label:"เดือนนี้",    value:"฿210K",                                  sub:"พ.ค. 2568",            color:K.purple, emoji:"📅"},
        ].map((card,i) => (
          <div key={i} style={{background:K.card, borderRadius:16, padding:16,
            border:`1.5px solid ${card.color}33`,
            boxShadow:`0 2px 8px ${K.shadow}`}}>
            <div style={{display:"flex", justifyContent:"space-between", marginBottom:6}}>
              <span style={{fontSize:12.1, color:K.muted, fontWeight:700}}>{card.label}</span>
              <span style={{fontSize:18}}>{card.emoji}</span>
            </div>
            <div style={{fontSize:22, fontWeight:900, color:card.color}}>{card.value}</div>
            <div style={{fontSize:12.1, color:K.dim, marginTop:2}}>{card.sub}</div>
          </div>
        ))}
      </div>

      <div style={{padding:"16px 16px 0", display:"flex", gap:8}}>
        {[{id:"daily",label:"รายวัน"},{id:"monthly",label:"รายเดือน"}].map(m=>(
          <button key={m.id} onClick={()=>setMode(m.id)} style={{
            flex:1, padding:"10px 0", borderRadius:12, border:`1.5px solid ${K.border}`,
            cursor:"pointer", fontWeight:700, fontSize:14.3,
            background:mode===m.id?K.text:K.card, color:mode===m.id?"white":K.muted,
            boxShadow:mode===m.id?`0 2px 8px ${K.shadow}`:"none"}}>{m.label}</button>
        ))}
      </div>

      <div style={{margin:"14px 16px 0", background:K.card, borderRadius:18, padding:18,
        border:`1.5px solid ${K.border}`, boxShadow:`0 2px 8px ${K.shadow}`}}>
        <div style={{fontSize:13.2, color:K.muted, fontWeight:700, marginBottom:16}}>
          {mode==="daily"?"ยอดขายรายวัน (สัปดาห์นี้)":"ยอดขายรายเดือน (2568)"}
        </div>
        <div style={{display:"flex", alignItems:"flex-end", gap:8, height:130}}>
          {(mode==="daily"?WEEKLY_SALES:MONTHLY_SALES).map((d,i,arr)=>{
            const pct = mode==="daily"?d.revenue/maxRev:d.revenue/maxMon;
            const isLast = i===arr.length-1;
            return (
              <div key={i} style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4}}>
                <div style={{fontSize:9.9, color:isLast?K.gold:K.muted, fontWeight:700, textAlign:"center"}}>
                  {mode==="daily"?`฿${(d.revenue/1000).toFixed(1)}K`:`฿${(d.revenue/1000).toFixed(0)}K`}
                </div>
                <div style={{width:"100%",
                  background:isLast?`linear-gradient(to top,${K.gold},${K.orange})`:`linear-gradient(to top,${K.blue}88,${K.purple}44)`,
                  borderRadius:"6px 6px 0 0", height:Math.max(8,pct*100)+"px",
                  transition:"height .5s ease",
                  boxShadow:isLast?`0 0 12px ${K.gold}55`:"none"}}/>
                <div style={{fontSize:9.9, color:isLast?K.gold:K.muted, fontWeight:700}}>
                  {mode==="daily"?d.day:d.month}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{margin:"12px 16px", background:K.card, borderRadius:18, padding:18,
        border:`1.5px solid ${K.border}`, boxShadow:`0 2px 8px ${K.shadow}`}}>
        <div style={{fontSize:13.2, color:K.muted, fontWeight:700, marginBottom:14}}>🏆 เมนูขายดีวันนี้</div>
        {[
          {rank:1,name:"ขาหมูพะโล้เตาถ่าน",qty:18,revenue:7200,color:K.gold},
          {rank:2,name:"ข้าวขาหมู",          qty:32,revenue:1920,color:"#999"},
          {rank:3,name:"กาแฟขี้ชะมด",        qty:14,revenue:2786,color:"#CD7F32"},
          {rank:4,name:"กาแฟลาเต้",          qty:11,revenue:825, color:K.dim},
          {rank:5,name:"ขาหมูผัดผัก",        qty:8, revenue:960, color:K.dim},
        ].map(item=>(
          <div key={item.rank} style={{display:"flex", alignItems:"center", gap:12,
            padding:"10px 0", borderBottom:`1px solid ${K.border}`}}>
            <span style={{fontWeight:900, color:item.color, fontSize:16.5, minWidth:26}}>#{item.rank}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:14.3, color:K.text, fontWeight:600}}>{item.name}</div>
              <div style={{fontSize:12.1, color:K.muted}}>{item.qty} จาน</div>
            </div>
            <div style={{fontWeight:800, color:item.color, fontSize:15.4}}>฿{item.revenue.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── STOCK DATA ─────────────────────────────────────────────────
const TODAY_LABEL = "27 พ.ค. 2569";

const STOCK_FRONT = [
  { id:"f1",  name:"ขาหน้า",       cat:"ขาหมู",       unit:"ชุด",  emoji:"🍖", qty:null, minQty:2  },
  { id:"f2",  name:"ขาหลัง",       cat:"ขาหมู",       unit:"ชุด",  emoji:"🍖", qty:6,    minQty:2  },
  { id:"f3",  name:"คากิ",         cat:"คากิ",        unit:"ชุด",  emoji:"🥩", qty:2,    minQty:2  },
  { id:"f4",  name:"คาจัก",        cat:"คากิ",        unit:"ชุด",  emoji:"🥩", qty:null, minQty:1  },
  { id:"f5",  name:"ผักกาดดอง",    cat:"เครื่องเคียง",unit:"กก.",  emoji:"🥬", qty:10,   minQty:3  },
  { id:"f6",  name:"น้ำจิ้ม",      cat:"เครื่องเคียง",unit:"ลิตร", emoji:"🫙", qty:1,    minQty:1  },
  { id:"f7",  name:"ไส้พะโล้",     cat:"เครื่องเคียง",unit:"ชุด",  emoji:"🫀", qty:1,    minQty:2  },
  { id:"f8",  name:"หมั่นโถว",     cat:"เครื่องเคียง",unit:"ลูก",  emoji:"🥟", qty:null, minQty:10 },
  { id:"f9",  name:"ไชเท้า",       cat:"เครื่องเคียง",unit:"กก.",  emoji:"🥒", qty:2,    minQty:2  },
  { id:"f10", name:"ไข่เป็ด",      cat:"เครื่องเคียง",unit:"แผง",  emoji:"🥚", qty:2,    minQty:1  },
];

const STOCK_KITCHEN = [
  { id:"k1",  name:"ขาหน้า",       cat:"ขาหมู",       unit:"ชุด",  emoji:"🍖", qty:0,    minQty:5  },
  { id:"k2",  name:"ขาหลัง",       cat:"ขาหมู",       unit:"ชุด",  emoji:"🍖", qty:23,   minQty:5  },
  { id:"k3",  name:"คากิ",         cat:"คากิ",        unit:"ชุด",  emoji:"🥩", qty:7,    minQty:3  },
  { id:"k4",  name:"คาจัก",        cat:"คากิ",        unit:"ชุด",  emoji:"🥩", qty:null, minQty:2  },
  { id:"k5",  name:"ผักกาดดอง",    cat:"เครื่องเคียง",unit:"กก.",  emoji:"🥬", qty:null, minQty:5  },
  { id:"k6",  name:"น้ำจิ้ม",      cat:"เครื่องเคียง",unit:"ลิตร", emoji:"🫙", qty:null, minQty:2  },
  { id:"k7",  name:"ไส้พะโล้",     cat:"เครื่องเคียง",unit:"กก.",  emoji:"🫀", qty:7,    minQty:3  },
];

// ── STOCK VIEW ─────────────────────────────────────────────────
function StockView() {
  const [loc, setLoc]       = useState("front"); // "front" | "kitchen"
  const [frontItems, setFrontItems]   = useState(STOCK_FRONT.map(i=>({...i})));
  const [kitchenItems, setKitchenItems] = useState(STOCK_KITCHEN.map(i=>({...i})));
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState("");

  const items    = loc === "front" ? frontItems : kitchenItems;
  const setItems = loc === "front" ? setFrontItems : setKitchenItems;

  const saveEdit = (id) => {
    const num = parseFloat(editVal);
    if (!isNaN(num) && num >= 0)
      setItems(prev => prev.map(it => it.id===id ? {...it, qty:num} : it));
    setEditId(null); setEditVal("");
  };

  // จัดกลุ่มตาม cat
  const cats = [...new Set(items.map(it => it.cat))];

  const lowAll = [...frontItems, ...kitchenItems].filter(it => it.qty !== null && it.qty <= it.minQty);
  const lowHere = items.filter(it => it.qty !== null && it.qty <= it.minQty);

  return (
    <div style={{paddingBottom:90}}>
      <Header
        title="เช็คสต็อก"
        subtitle={TODAY_LABEL}
        right={lowAll.length > 0 && (
          <div style={{background:`${K.red}15`, border:`1.5px solid ${K.red}44`,
            borderRadius:12, padding:"6px 12px", textAlign:"center"}}>
            <div style={{fontSize:20, fontWeight:900, color:K.red}}>{lowAll.length}</div>
            <div style={{fontSize:11, color:K.red, fontWeight:700}}>ใกล้หมด</div>
          </div>
        )}
      />

      {/* Location tabs */}
      <div style={{display:"flex", margin:"14px 16px 0", gap:8}}>
        {[
          {id:"front",   label:"🏪 หน้าร้าน"},
          {id:"kitchen", label:"👨‍🍳 ครัวกลาง"},
        ].map(t => (
          <button key={t.id} onClick={() => setLoc(t.id)} style={{
            flex:1, padding:"11px 0", borderRadius:14, border:`1.5px solid ${loc===t.id?K.gold:K.border}`,
            background:loc===t.id?K.gold:"none", color:loc===t.id?"white":K.muted,
            fontWeight:800, fontSize:14.3, cursor:"pointer",
            boxShadow:loc===t.id?`0 4px 12px ${K.gold}44`:"none",
            transition:"all .2s"}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Low stock alert for this location */}
      {lowHere.length > 0 && (
        <div style={{margin:"12px 16px 0", background:`${K.red}10`,
          border:`1.5px solid ${K.red}44`, borderRadius:14, padding:"12px 16px"}}>
          <div style={{fontWeight:800, color:K.red, fontSize:14.3, marginBottom:6}}>⚠️ วัตถุดิบใกล้หมด!</div>
          {lowHere.map(it => (
            <div key={it.id} style={{fontSize:13.2, color:K.red, marginTop:3, opacity:.85}}>
              • {it.emoji} {it.name} เหลือ {it.qty} {it.unit} (ต่ำสุด {it.minQty} {it.unit})
            </div>
          ))}
        </div>
      )}

      {/* Stock items by category */}
      <div style={{padding:"14px 16px 0"}}>
        {cats.map(cat => (
          <div key={cat} style={{marginBottom:18}}>
            <div style={{fontSize:11, fontWeight:800, color:K.muted, letterSpacing:2,
              textTransform:"uppercase", marginBottom:8, paddingLeft:2}}>
              📦 {cat}
            </div>
            <div style={{display:"flex", flexDirection:"column", gap:8}}>
              {items.filter(it => it.cat===cat).map(item => {
                const isEmpty = item.qty === null;
                const isLow   = !isEmpty && item.qty <= item.minQty;
                const pct     = isEmpty ? 0 : Math.min(1, item.qty / (item.minQty * 3));
                const barColor = isEmpty ? K.dim : isLow ? K.red : item.qty <= item.minQty*1.5 ? K.orange : K.green;

                return (
                  <div key={item.id} style={{background:K.card, borderRadius:14, padding:"12px 14px",
                    border:`1.5px solid ${isLow||isEmpty?K.red+"44":K.border}`,
                    boxShadow:isLow?`0 2px 12px ${K.red}18`:`0 2px 8px ${K.shadow}`}}>
                    <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:isEmpty?0:8}}>
                      <div style={{display:"flex", alignItems:"center", gap:9}}>
                        <span style={{fontSize:22}}>{item.emoji}</span>
                        <div>
                          <div style={{fontSize:14.3, fontWeight:700, color:isEmpty?K.dim:K.text}}>{item.name}</div>
                          <div style={{fontSize:11, color:K.dim}}>ต่ำสุด {item.minQty} {item.unit}</div>
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        {editId === item.id ? (
                          <div style={{display:"flex", gap:6, alignItems:"center"}}>
                            <input type="number" value={editVal}
                              onChange={e => setEditVal(e.target.value)}
                              onBlur={() => saveEdit(item.id)}
                              onKeyDown={e => e.key==="Enter" && saveEdit(item.id)}
                              autoFocus
                              style={{width:64, background:K.bg, border:`1.5px solid ${K.gold}`,
                                borderRadius:8, color:K.gold, fontSize:15.4, fontWeight:800,
                                textAlign:"center", padding:"4px 6px"}}/>
                            <span style={{fontSize:12.1, color:K.muted}}>{item.unit}</span>
                          </div>
                        ) : (
                          <button onClick={() => { setEditId(item.id); setEditVal(isEmpty?"":String(item.qty)); }}
                            style={{background:"none", border:"none", cursor:"pointer", textAlign:"right"}}>
                            <div style={{fontSize:19.8, fontWeight:900,
                              color:isEmpty?K.dim:isLow?K.red:K.text}}>
                              {isEmpty ? "—" : item.qty}
                            </div>
                            <div style={{fontSize:11, color:K.muted}}>{item.unit} ✏️</div>
                          </button>
                        )}
                      </div>
                    </div>
                    {!isEmpty && (
                      <>
                        <div style={{background:K.bg, borderRadius:4, height:6, overflow:"hidden"}}>
                          <div style={{height:"100%", width:`${pct*100}%`, background:barColor,
                            borderRadius:4, transition:"width .4s ease"}}/>
                        </div>
                        {isLow && <div style={{marginTop:6, fontSize:11, color:K.red, fontWeight:700}}>⚠️ ต้องสั่งเพิ่ม!</div>}
                      </>
                    )}
                    {isEmpty && (
                      <div style={{fontSize:11, color:K.dim, marginTop:2}}>ยังไม่ได้บันทึก · กดเพื่อกรอก</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── CLOSING VIEW ───────────────────────────────────────────────
function ClosingView() {
  const [checked, setChecked] = useState(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const zones = [...new Set(CLOSING_STEPS.map(s=>s.zone))];
  const total  = CLOSING_STEPS.length;
  const done   = checked.size;
  const allDone      = done===total;
  const criticalDone = CLOSING_STEPS.filter(s=>s.critical).every(s=>checked.has(s.id));

  const toggle = (id) => {
    setChecked(prev=>{const next=new Set(prev); next.has(id)?next.delete(id):next.add(id); return next;});
  };

  return (
    <div style={{paddingBottom:90}}>
      <Header title="ขั้นตอนปิดร้าน" subtitle={`${done}/${total} รายการ`}/>

      <div style={{padding:"14px 16px 0"}}>
        <div style={{background:K.card, borderRadius:16, padding:16,
          border:`1.5px solid ${K.border}`, marginBottom:14,
          boxShadow:`0 2px 8px ${K.shadow}`}}>
          <div style={{display:"flex", justifyContent:"space-between", marginBottom:10}}>
            <span style={{fontSize:14.3, color:K.muted, fontWeight:700}}>ความคืบหน้า</span>
            <span style={{fontSize:14.3, fontWeight:900, color:allDone?K.green:K.gold}}>
              {Math.round(done/total*100)}%
            </span>
          </div>
          <div style={{background:K.bg, borderRadius:6, height:11, overflow:"hidden"}}>
            <div style={{height:"100%", width:`${done/total*100}%`,
              background:allDone?K.green:`linear-gradient(90deg,${K.gold},${K.orange})`,
              borderRadius:6, transition:"width .4s ease"}}/>
          </div>
          {!criticalDone && <div style={{marginTop:8, fontSize:12.1, color:K.orange}}>⚠️ ยังมีรายการสำคัญที่ยังไม่ได้ทำ</div>}
          {criticalDone && !allDone && <div style={{marginTop:8, fontSize:12.1, color:K.green}}>✅ รายการสำคัญครบแล้ว</div>}
        </div>
      </div>

      {zones.map(zone=>(
        <div key={zone} style={{padding:"0 16px", marginBottom:14}}>
          <div style={{fontSize:12.1, fontWeight:800, color:K.muted, letterSpacing:2,
            textTransform:"uppercase", marginBottom:10, paddingLeft:4}}>📍 {zone}</div>
          <div style={{background:K.card, borderRadius:16, border:`1.5px solid ${K.border}`,
            overflow:"hidden", boxShadow:`0 2px 8px ${K.shadow}`}}>
            {CLOSING_STEPS.filter(s=>s.zone===zone).map((step,i,arr)=>{
              const isDone = checked.has(step.id);
              return (
                <div key={step.id} onClick={()=>toggle(step.id)} style={{
                  padding:"14px 16px",
                  borderBottom:i<arr.length-1?`1px solid ${K.border}`:"none",
                  display:"flex", alignItems:"center", gap:12, cursor:"pointer",
                  background:isDone?`${K.green}08`:"transparent", transition:"background .2s"}}>
                  <div style={{width:26, height:26, borderRadius:8, flexShrink:0,
                    background:isDone?K.green:K.bg, border:`2px solid ${isDone?K.green:K.border}`,
                    display:"flex", alignItems:"center", justifyContent:"center", transition:"all .2s"}}>
                    {isDone && <span style={{fontSize:14, color:"white"}}>✓</span>}
                  </div>
                  <span style={{fontSize:20}}>{step.icon}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14.3, fontWeight:600,
                      color:isDone?K.dim:K.text, textDecoration:isDone?"line-through":"none", transition:"all .2s"}}>
                      {step.task}
                    </div>
                    {step.critical && !isDone && (
                      <div style={{fontSize:11, color:K.red, fontWeight:700, marginTop:2}}>⚡ สำคัญ</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {criticalDone && (
        <div style={{padding:"0 16px 24px"}}>
          <button onClick={()=>setShowConfirm(true)} style={{
            width:"100%", padding:20, borderRadius:20, border:"none", cursor:"pointer",
            background:allDone?K.green:K.gold, color:"white",
            fontSize:17.6, fontWeight:900,
            boxShadow:`0 8px 28px ${allDone?K.green:K.gold}44`}}>
            {allDone?"🎉 ปิดร้านเสร็จสมบูรณ์!":"🔒 ยืนยันปิดร้านวันนี้"}
          </button>
        </div>
      )}

      {showConfirm && (
        <div style={{position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"flex-end"}}>
          <div onClick={()=>setShowConfirm(false)} style={{position:"absolute", inset:0, background:"rgba(0,0,0,.5)"}}/>
          <div style={{position:"relative", width:"100%", background:K.card,
            borderRadius:"24px 24px 0 0", padding:28, maxWidth:480, margin:"0 auto",
            boxShadow:"0 -8px 40px rgba(0,0,0,.15)"}}>
            <div style={{textAlign:"center", marginBottom:20}}>
              <div style={{fontSize:48, marginBottom:8}}>🔒</div>
              <h3 style={{fontSize:22, fontWeight:900, color:K.text, marginBottom:8}}>ยืนยันปิดร้าน?</h3>
              <p style={{fontSize:14.3, color:K.muted, lineHeight:1.6}}>
                ยอดขายวันนี้จะถูกบันทึก<br/>
                <span style={{color:K.gold, fontWeight:800}}>฿9,200 · 28 ออเดอร์</span>
              </p>
            </div>
            <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12}}>
              <button onClick={()=>setShowConfirm(false)} style={{
                padding:15, borderRadius:14, border:`1.5px solid ${K.border}`,
                background:K.bg, color:K.muted, fontWeight:700, cursor:"pointer", fontSize:15.4}}>ยกเลิก</button>
              <button onClick={()=>{setShowConfirm(false); alert("✅ ปิดร้านเสร็จสิ้น! บันทึกยอดขายแล้ว");}} style={{
                padding:15, borderRadius:14, border:"none",
                background:K.green, color:"white", fontWeight:800, cursor:"pointer", fontSize:15.4,
                boxShadow:`0 4px 16px ${K.green}44`}}>✅ ยืนยัน</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MAIN ───────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]           = useState("orders");
  const [liffReady, setLiffReady] = useState(false);
  const [staffProfile, setStaffProfile] = useState(null); // LINE profile ของพนักงาน
  const [authorized, setAuthorized]     = useState(false);
  const [authError, setAuthError]       = useState(null);

  // ── init LIFF เมื่อ mount ──────────────────────────────────
  useEffect(() => {
    initKitchenLiff().then(() => {
      setLiffReady(true);
      if (_kitchenProfile) setStaffProfile(_kitchenProfile);
      if (_kitchenLiffReady && !_kitchenProfile) return; // รอ login redirect
      setAuthorized(_isStaff);
      if (_kitchenLiffReady && _kitchenProfile && !_isStaff) {
        setAuthError(`❌ บัญชีนี้ไม่มีสิทธิ์เข้าห้องครัว\n(${_kitchenProfile.displayName})`);
      }
    });
  }, []);

  // ── Loading / Auth screens ─────────────────────────────────
  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;600;700;800;900&display=swap');
    * { box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent; }
    button,input { font-family:inherit; }
    input { outline:none; }
    @keyframes pulse    { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1)} }
    @keyframes fadeIn   { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
    @keyframes slideDown{ from{opacity:0;transform:translateY(-10px)} to{opacity:1;transform:translateY(0)} }
    ::-webkit-scrollbar { display:none }
    @keyframes spin { to { transform:rotate(360deg) } }
  `;

  const wrapStyle = {
    minHeight:"100vh", background:K.bg, color:K.text,
    fontFamily:"'Noto Sans Thai','Sarabun',system-ui,sans-serif",
    maxWidth:480, margin:"0 auto", position:"relative"
  };

  // Loading
  if (!liffReady) return (
    <div style={{...wrapStyle, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center"}}>
      <style>{styles}</style>
      <div style={{width:48, height:48, border:`4px solid ${K.border}`, borderTopColor:K.gold,
        borderRadius:"50%", animation:"spin 1s linear infinite", marginBottom:20}}/>
      <div style={{fontSize:16, fontWeight:700, color:K.muted}}>กำลังเชื่อมต่อ LINE...</div>
    </div>
  );

  // Unauthorized
  if (liffReady && !authorized) return (
    <div style={{...wrapStyle, display:"flex", flexDirection:"column", alignItems:"center",
      justifyContent:"center", padding:32, textAlign:"center"}}>
      <style>{styles}</style>
      <div style={{fontSize:72, marginBottom:16}}>🔒</div>
      <h2 style={{fontSize:22, fontWeight:900, color:K.text, marginBottom:8}}>
        {authError ? "ไม่มีสิทธิ์เข้าใช้งาน" : "กำลัง Login..."}
      </h2>
      <p style={{fontSize:14, color:K.muted, lineHeight:1.7, whiteSpace:"pre-line", marginBottom:24}}>
        {authError || "กรุณารอสักครู่"}
      </p>
      {authError && (
        <button onClick={() => getKitchenLiff()?.login()}
          style={{padding:"14px 28px", borderRadius:16, background:"#06C755", color:"white",
            fontWeight:800, fontSize:15, border:"none", cursor:"pointer"}}>
          เข้าสู่ระบบด้วยบัญชีอื่น
        </button>
      )}
    </div>
  );

  // Main kitchen app
  return (
    <div style={wrapStyle}>
      <style>{styles}</style>

      {/* Staff badge */}
      {staffProfile && (
        <div style={{position:"fixed", top:0, left:0, right:0, zIndex:100, maxWidth:480, margin:"0 auto",
          background:"#06C755", padding:"6px 16px", display:"flex", alignItems:"center", gap:8}}>
          <img src={staffProfile.pictureUrl} style={{width:24, height:24, borderRadius:"50%"}} alt=""/>
          <span style={{fontSize:12, fontWeight:700, color:"white", flex:1}}>{staffProfile.displayName}</span>
          <span style={{fontSize:11, color:"rgba(255,255,255,.8)"}}>ห้องครัว ✓</span>
        </div>
      )}

      <div style={{paddingTop: staffProfile ? 40 : 4}}>
        {tab==="orders"  && <OrdersView pushStatus={pushStatusToCustomer} makeStatusFlex={makeStatusFlex}/>}
        {tab==="sales"   && <SalesView/>}
        {tab==="stock"   && <StockView/>}
        {tab==="closing" && <ClosingView/>}
      </div>
      <NavBar tab={tab} setTab={setTab}/>
    </div>
  );
}
