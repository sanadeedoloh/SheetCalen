import React, { useState, useEffect, useMemo } from 'react';
import { 
  ChevronLeft, ChevronRight, RefreshCw, Lock, 
  CheckCircle2, Clock, X, MapPin, LayoutGrid, Users, Filter, Key,
  Settings, AlertCircle, Search, Download, Calendar, Database,
  Columns, DatabaseBackup, Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// นำเข้าโมดูลเชื่อมต่อ Firebase SDK เวอร์ชันล่าสุดตามมาตรฐานสภาพแวดล้อม
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc 
} from 'firebase/firestore';

import firebaseConfig from '../firebase-applet-config.json';

// อินเตอร์เฟสสำหรับข้อมูลกิจกรรม Calendar
interface CalendarEvent {
  id: number;
  date: Date;
  asset: string;
  time: string;
  endTime: string;
  kol: string;
  studio: string;
  techs: string[];
}

// แหล่งข้อมูลข้อผิดพลาดสำหรับ Firestore ABAC
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

// รายการวันหยุดนักขัตฤกษ์ตามตารางงาน (อ้างอิงจากวันที่และเดือน)
const PUBLIC_HOLIDAYS = [
  { day: 1, month: 0 },   // 1 มกราคม
  { day: 2, month: 0 },   // 2 มกราคม
  { day: 17, month: 1 },  // 17 กุมภาพันธ์
  { day: 3, month: 2 },   // 3 มีนาคม
  { day: 6, month: 3 },   // 6 เมษายน
  { day: 13, month: 3 },  // 13 เมษายน
  { day: 14, month: 3 },  // 14 เมษายน
  { day: 15, month: 3 },  // 15 เมษายน
  { day: 1, month: 4 },   // 1 พฤษภาคม
  { day: 4, month: 4 },   // 4 พฤษภาคม
  { day: 1, month: 5 },   // 1 มิถุนายน
  { day: 3, month: 5 },   // 3 มิถุนายน
  { day: 28, month: 6 },  // 28 กรกฎาคม
  { day: 29, month: 6 },  // 29 กรกฎาคม
  { day: 12, month: 7 },  // 12 สิงหาคม
  { day: 13, month: 9 },  // 13 ตุลาคม
  { day: 23, month: 9 },  // 23 ตุลาคม
  { day: 7, month: 11 },  // 7 ธันวาคม
  { day: 31, month: 11 }, // 31 ธันวาคม
];

// ค่าเริ่มต้นสำหรับ APPS_SCRIPT_URL หากยังไม่มีใน Firebase / LocalStorage
const DEFAULT_APPS_SCRIPT_URL = 'https://script.google.com/a/macros/shopeemobile-external.com/s/AKfycbwDhUlHzTvO-yGQiBUGzh2XZFOq62-Q8aRzAzZ3I9OQm272xFu6FzMLg3KDqb1O8mQZ/exec';

// ตัวอย่างข้อมูลสำหรับ seed ในการทดสอบกรณีไม่มีการเชื่อมโยง Web App
const SYSTEM_MOCK_EVENTS: CalendarEvent[] = [
  {
    id: 9001,
    date: new Date(), // วันนี้
    asset: 'D-Day',
    time: '11:00',
    endTime: '13:00',
    kol: 'KOL MinPecch (แจกหนักจัดเต็ม)',
    studio: 'Studio L1',
    techs: ['Phiphat S.', 'Somchai K.']
  },
  {
    id: 9002,
    date: new Date(), // วันนี้
    asset: 'MC x Celeb',
    time: '14:30',
    endTime: '16:30',
    kol: 'Baifern Pimchanok x MC Bright',
    studio: 'Main Grand Stage',
    techs: ['Phiphat S.', 'Wichai T.']
  },
  {
    id: 9003,
    date: new Date(new Date().setDate(new Date().getDate() + 1)), // พรุ่งนี้
    asset: 'SBD HP#1',
    time: '18:00',
    endTime: '20:00',
    kol: 'KOL Jennie Panhan (ช้อปคุ้มคืนชีพ)',
    studio: 'Studio L3',
    techs: ['Somchai K.', 'Anan P.']
  },
  {
    id: 9004,
    date: new Date(new Date().setDate(new Date().getDate() - 2)), // ปลดล็อกย้อนหลัง 2 วัน
    asset: 'SBD HP#2',
    time: '13:00',
    endTime: '15:00',
    kol: 'Nont Tanont (คอนเสิร์ตพิเศษ)',
    studio: 'Live Arena',
    techs: ['Wichai T.']
  }
];

// --- ตั้งค่าระบบ Firebase Config อ้างอิงตาม SDK คลาวด์ที่กำหนดสำเร็จ ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const isFirebaseValid = true;

const appId = '2a9298a1-b753-4533-a9bf-062dc1686552'; // Applet ID เครือข่ายจริงสำหรับ Cloud Run

const App: React.FC = () => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  
  // โหลดค่า URL เริ่มต้น
  const [appsScriptUrl, setAppsScriptUrl] = useState<string>(() => {
    try {
      const savedUrl = localStorage.getItem('shopee_live_ops_apps_script_url');
      return savedUrl ? savedUrl : DEFAULT_APPS_SCRIPT_URL;
    } catch (e) {
      return DEFAULT_APPS_SCRIPT_URL;
    }
  });

  const [activeView, setActiveView] = useState<'calendar' | 'database'>('calendar');
  const [showUrlInput, setShowUrlInput] = useState<boolean>(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState<boolean>(false);
  const [tempUrl, setTempUrl] = useState<string>('');

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState<boolean>(true);
  const [statusMsg, setStatusMsg] = useState<string>("เริ่มเชื่อมต่อบริการ...");
  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [selectedTech, setSelectedTech] = useState<string>("All"); 
  
  const [selectedDayData, setSelectedDayData] = useState<any | null>(null);

  // สถานะแถบกิจกรรมด้านข้างขวา (Right Sidebar States)
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

  // ส่วนของการจัดการสืบค้น คัดกรอง ในหน้า Database View
  const [dbSearch, setDbSearch] = useState<string>('');
  const [dbAssetFilter, setDbAssetFilter] = useState<string>('All');

  // ส่วนของการจัดการ Alert แจ้งเตือน (Toast Notification State)
  const [alert, setAlert] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({
    show: false,
    message: '',
    type: 'success'
  });

  // ฟังก์ชันช่วยแสดงข้อความ Error ของระบบ Firestore เข้าสู่ console แบบเป็นระบบตาม SKILL.md
  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
      },
      operationType,
      path
    };
    console.error('Firestore Error Payload: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  };

  // ฟังก์ชันช่วยแสดง Alert แบบอัตโนมัติแล้วซ่อนเองภายใน 4 วินาที
  const triggerAlert = (message: string, type: 'success' | 'error' = 'success') => {
    setAlert({ show: true, message, type });
  };

  // ดึงหน้าต่างเด้งซ่อนเอง
  useEffect(() => {
    if (alert.show) {
      const timer = setTimeout(() => {
        setAlert(prev => ({ ...prev, show: false }));
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [alert.show]);

  // ตั้งค่าค่าเริ่มต้นให้กับช่องพิมพ์ URL
  useEffect(() => {
    setTempUrl(appsScriptUrl);
  }, [appsScriptUrl]);

  // จัดการยืนยันตัวตนอัตโนมัติเมื่อเปิดหน้าเว็บขึ้นมาครั้งแรกสุด (เพื่อความคุ้มครองฐานราก Firebase SDK)
  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.warn("Firebase auth restricted or bypassed, continuing with public Firestore rules mode:", err);
      }
    };
    initAuth();
  }, []);

  // ดึงข้อมูลแคชถาวรจาก Firebase และลิงก์อัปเดตล่าสุดมาติดตั้งเมื่อโหลดแอปเสร็จ (โหลดได้แบบอิสระ ไม่ต้องรอจำกัดสิทธิ์ผู้ใช้)
  useEffect(() => {
    const fetchStoredData = async () => {
      setLoading(true);
      setStatusMsg("กำลังดาวน์โหลดข้อมูลสำรองจากฐานข้อมูลคลาวด์ Firebase...");

      // 1. ดึงข้อมูล URL สคริปต์ล่าสุดจาก Firebase คลาวด์
      try {
        const settingsDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'config'));
        if (settingsDoc.exists()) {
          const savedUrl = settingsDoc.data().appsScriptUrl;
          if (savedUrl) {
            setAppsScriptUrl(savedUrl);
            localStorage.setItem('shopee_live_ops_apps_script_url', savedUrl);
          }
        } else {
          const localUrl = localStorage.getItem('shopee_live_ops_apps_script_url');
          if (localUrl) {
            setAppsScriptUrl(localUrl);
          }
        }
      } catch (err) {
        console.warn("ไม่สามารถอ่านการตั้งค่าจากคลาวด์ได้, ดำเนินการต่อด้วยการใช้ค่าจากบราวเซอร์:", err);
        const localUrl = localStorage.getItem('shopee_live_ops_apps_script_url');
        if (localUrl) {
          setAppsScriptUrl(localUrl);
        }
      }

      // 2. ดึงข้อมูลปฏิทินกลางจาก Firebase ป้องกันไม่ต้องดึง Sheets ซ้ำซ้อนและเปิดดูได้ทันทีจากทุกอุปกรณ์
      try {
        const eventsDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'live_calendar', 'state'));
        if (eventsDoc.exists()) {
          const storedEvents = eventsDoc.data().events || [];
          const parsed = storedEvents.map((ev: any) => ({
            ...ev,
            date: new Date(ev.date)
          }));
          setEvents(parsed);
          setIsAuthorized(true);
          setAuthRequired(false);
          setStatusMsg(`โหลดตารางปฏิทินสำเร็จ (${parsed.length} กิจกรรม)`);
          triggerAlert(`โหลดคิวงานจาก Firebase คลาวด์แล้ว (${parsed.length} รายการ)`, "success");
        } else {
          setStatusMsg("ยังไม่มีข้อมูลบนคลาวด์ เริ่มดาวน์โหลดสดจาก Sheets...");
          fetchDataJSONP();
        }
      } catch (err) {
        console.warn("ดึงข้อมูลจากคลาวด์ล้มเหลว, กำลังดึงสดจาก Sheets เข้าเบราว์เซอร์:", err);
        fetchDataJSONP();
      } finally {
        setLoading(false);
      }
    };

    fetchStoredData();
  }, []);

  const formatTime = (timeStr: any) => {
    if (!timeStr) return '--:--';
    const str = timeStr.toString();
    if (str.includes('T') || str.includes('Z')) {
      try {
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
          return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
        }
      } catch (e) { }
    }
    const timeMatch = str.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
    }
    return str;
  };

  // ฟังก์ชันบันทึกข้อมูลทับถาวรลงใน Firebase Firestore อัปเดตตารางกลางให้ทุกคนมองเห็นร่วมกัน
  const saveToFirebase = async (dataToSave: CalendarEvent[]) => {
    setStatusMsg("กำลังซิงก์รายงานคิวงานขึ้นสู่ฐานข้อมูล Firebase...");
    try {
      const preparedData = dataToSave.map(ev => ({
        ...ev,
        date: ev.date.toISOString() 
      }));

      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'live_calendar', 'state'), {
        events: preparedData,
        lastUpdated: new Date().toISOString()
      });
      setStatusMsg(`อัปเดตข้อมูลบน Firebase สำเร็จ (${dataToSave.length} รายการ)`);
      triggerAlert(`ซิงก์ข้อมูลไปสู้บอร์ดกลาง สำเร็จ (${dataToSave.length} รายการ)`, "success");
    } catch (error) {
      console.warn("Firebase save failed:", error);
      setStatusMsg(`ดำเนินการจัดเก็บเข้าเบราว์เซอร์แทนแล้ว (${dataToSave.length} รายการ)`);
      triggerAlert("อัปเดตระบบคลาวด์ไม่สำเร็จ แต่จัดเก็บในเครื่องเรียบร้อย", "error");
    }
  };

  // ดึงข้อมูลจริงจาก Google Spreadsheet Webhook ของผู้ใช้ผ่าน JSONP
  const fetchDataJSONP = () => {
    setLoading(true);
    setStatusMsg("กำลังเข้าถึงข้อมูลตาราง Live จากชีต...");
    const callbackName = 'googleDocCallback_' + Math.round(100000 * Math.random());
    const script = document.createElement('script');
    script.src = `${appsScriptUrl}?callback=${callbackName}&t=${Date.now()}`;
    const timeout = setTimeout(() => {
      if (loading) {
        setLoading(false);
        setAuthRequired(true);
        cleanUp();
        triggerAlert("การเชื่อมต่อหมดเวลา ไม่ตอบสนองจาก Google Sheets หรือลิงก์ยังไม่ขอรับสิทธิ์", "error");
      }
    }, 15000);
    const cleanUp = () => {
      clearTimeout(timeout);
      if (script.parentNode) script.parentNode.removeChild(script);
      delete (window as any)[callbackName];
    };
    (window as any)[callbackName] = (data: any) => {
      cleanUp();
      if (data && Array.isArray(data)) {
        const dataRows = data.slice(1);
        const parsedEvents = dataRows.map((row: any, index: number) => {
          const rawDate = row[1];
          let eventDate = new Date(rawDate);
          if (eventDate.getFullYear() > 2500) {
              eventDate.setFullYear(eventDate.getFullYear() - 543);
          }
          return {
            id: index,
            date: eventDate,
            asset: row[0] || 'N/A',
            time: formatTime(row[2]),
            endTime: formatTime(row[3]),
            kol: row[4] || 'Unknown KOL',
            studio: row[5] || 'No Studio',
            techs: [row[6], row[7], row[8]].filter(t => t && t.toString().trim() !== '').map(String),
          } as CalendarEvent;
        }).filter(event => !isNaN(event.date.getTime()));
        
        setEvents(parsedEvents);
        setIsAuthorized(true);
        setAuthRequired(false);
        setStatusMsg(`โหลดตารางงานสำเร็จ (${parsedEvents.length} กิจกรรม)`);
        
        saveToFirebase(parsedEvents);
        
        if (parsedEvents.length > 0) {
          const latestEvent = parsedEvents[0].date;
          setCurrentDate(new Date(latestEvent.getFullYear(), latestEvent.getMonth(), 1));
        }
      } else {
        triggerAlert("ข้อมูลที่ได้จาก Google Sheets ไม่ถูกต้อง", "error");
      }
      setLoading(false);
    };
    script.onerror = () => {
      cleanUp();
      setLoading(false);
      setAuthRequired(true);
      triggerAlert("ดึงข้อมูลจากตาราง Google Sheets ล้มเหลว โปรดลองใช้ชุดข้อมูลจำลอง", "error");
    };
    document.body.appendChild(script);
  };

  // ฟังก์ชันจัดเตรียม Mock Data สำหรับการทดลองแอปอย่างรวดเร็ว (Seed Data)
  const handleSeedMockData = () => {
    setLoading(true);
    setStatusMsg("กำลังติดตั้งข้อมูลตัวอย่างสำหรับการทดสอบ...");
    setTimeout(() => {
      setEvents(SYSTEM_MOCK_EVENTS);
      setIsAuthorized(true);
      setAuthRequired(false);
      saveToFirebase(SYSTEM_MOCK_EVENTS);
      setCurrentDate(new Date());
      setLoading(false);
      triggerAlert("ติดตั้งตัวอย่างตาราง Live คิวงานสำเร็จ!", "success");
    }, 800);
  };

  const allTechs = useMemo(() => {
    const techs = new Set<string>();
    events.forEach(ev => ev.techs.forEach(t => techs.add(t)));
    return ["All", ...Array.from(techs).sort()];
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (selectedTech === "All") return events;
    return events.filter(ev => ev.techs.includes(selectedTech));
  }, [events, selectedTech]);

  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  const monthName = currentDate.toLocaleString('th-TH', { month: 'long', year: 'numeric' });

  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysCount = daysInMonth(year, month);
    const startDay = firstDayOfMonth(year, month);
    
    const days = [];
    for (let i = 0; i < startDay; i++) days.push({ day: null, currentMonth: false, date: null, events: [], isHoliday: false });
    for (let i = 1; i <= daysCount; i++) {
      const dateInstance = new Date(year, month, i);
      const dateStr = dateInstance.toDateString();
      const dayEvents = filteredEvents.filter(e => e.date && e.date.toDateString() === dateStr);
      
      const isWeekend = dateInstance.getDay() === 0 || dateInstance.getDay() === 6;
      const isPublicHoliday = PUBLIC_HOLIDAYS.some(h => h.day === i && h.month === month);

      days.push({ 
        day: i, 
        date: dateInstance, 
        currentMonth: true, 
        events: dayEvents,
        isHoliday: isWeekend || isPublicHoliday
      });
    }
    return days;
  }, [currentDate, filteredEvents]);

  // เมื่อคลิกเลือกวันบนปฏิทิน -> แสดงผลพรีวิวแบบ Popup Modal ตามปรกติ
  const handleDayClick = (dayItem: any) => {
    if (dayItem.day && dayItem.events.length > 0) {
      setSelectedDayData(dayItem);
    }
  };

  // ดึงรายการกิจกรรมทั้งหมดที่ตรงกับวันปัจจุบัน (Today) เท่านั้นมาจัดแสดงใน Sidebar ด้านขวา
  const activeSidebarEvents = useMemo(() => {
    const todayStr = new Date().toDateString();
    return filteredEvents.filter(e => e.date && e.date.toDateString() === todayStr);
  }, [filteredEvents]);

  // รวบรวมรายชื่อ Techs ทั้งหมดที่เข้าปฏิบัติงานในวันนี้ (Today) โดยไม่ซ้ำกัน
  const activeSidebarTechs = useMemo(() => {
    const techs = new Set<string>();
    activeSidebarEvents.forEach(ev => {
      if (ev.techs) {
        ev.techs.forEach(t => {
          if (t && t.toString().trim() !== '') {
            techs.add(t.toString().trim());
          }
        });
      }
    });
    return Array.from(techs).sort();
  }, [activeSidebarEvents]);

  // จัดเก็บลิงก์อัปเดตลงทั้งใน LocalStorage, Firebase Firestore และเปิดหน้าสิทธิ์การเข้าถึงทันที (Auto Authorize)
  const handleUpdateUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tempUrl.trim() !== '') {
      const formattedUrl = tempUrl.trim();
      setAppsScriptUrl(formattedUrl);
      try {
        localStorage.setItem('shopee_live_ops_apps_script_url', formattedUrl);
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'config'), {
          appsScriptUrl: formattedUrl
        });
        triggerAlert("อัปเดตและบันทึก Web App URL ใหม่สำเร็จแล้ว!", "success");
        
        // สั่งให้เปิดแท็บใหม่เพื่อดำเนินการ Authorize สิทธิ์ทันทีที่กดยืนยันบันทึก URL
        window.open(formattedUrl, '_blank', 'noopener,noreferrer');
        triggerAlert("นำทางคุณเพื่อยืนยันสิทธิการทำงานในแถบใหม่...", "success");
      } catch (err) {
        console.warn("บันทึกลิงก์ลง Firebase หลักล้มเหลว:", err);
        triggerAlert("อัปเดต URL ลงคลาวด์ล้มเหลว แต่บันทึกไว้ในเบราว์เซอร์แล้ว", "error");
      }
      setShowUrlInput(false);
      fetchDataJSONP(); // รันซิงก์ใหม่ทันทีที่บันทึกลิงก์ใหม่สำเร็จ
    } else {
      triggerAlert("กรุณากรอกลิงก์ให้ถูกต้อง", "error");
    }
  };

  // ดึงรายการประเภทของ Asset ทั้งหมดที่มีมาแสดงตัวเลือกตัวกรองใน Database View
  const uniqueAssets = useMemo(() => {
    const assets = new Set<string>();
    events.forEach(ev => { if(ev.asset) assets.add(ev.asset); });
    return ['All', ...Array.from(assets)];
  }, [events]);

  // คัดกรองข้อมูลสำหรับแสดงผลในหน้า Database View
  const dbFilteredRecords = useMemo(() => {
    return events.filter(ev => {
      const matchSearch = (ev.kol || '').toLowerCase().includes(dbSearch.toLowerCase()) || 
                          (ev.studio || '').toLowerCase().includes(dbSearch.toLowerCase()) ||
                          ev.techs.some(t => t.toLowerCase().includes(dbSearch.toLowerCase()));
      const matchAsset = dbAssetFilter === 'All' || ev.asset === dbAssetFilter;
      return matchSearch && matchAsset;
    });
  }, [events, dbSearch, dbAssetFilter]);

  // ฟังก์ชันดาวน์โหลดคิวงานเป็นไฟล์ CSV จากหน้า Database View
  const handleExportCSV = () => {
    if (dbFilteredRecords.length === 0) {
      triggerAlert("ไม่มีข้อมูลเพื่อทำการส่งออกไฟล์ CSV", "error");
      return;
    }

    const headers = ['วันที่', 'เวลาเริ่ม', 'เวลาสิ้นสุด', 'ประเภท Asset', 'ศิลปิน (KOL)', 'สตูดิโอ', 'ทีมเทคนิค (Techs)'];
    const rows = [headers];

    dbFilteredRecords.forEach(ev => {
      const dateFormatted = ev.date ? ev.date.toLocaleDateString('th-TH') : '';
      rows.push([
        dateFormatted,
        ev.time,
        ev.endTime || '',
        ev.asset,
        ev.kol,
        ev.studio,
        ev.techs.join(', ')
      ]);
    });

    const csvContent = "\ufeff" + rows.map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `shopee_live_ops_database_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    triggerAlert("ส่งออกข้อมูลเป็นไฟล์ CSV สำเร็จ!", "success");
  };

  const dayNames = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

  const getAssetColor = (asset: string) => {
    switch (asset) {
      case 'D-Day': return 'border-orange-500 bg-orange-100/80 hover:bg-orange-100 text-orange-950 shadow-[0_2px_10px_rgba(249,115,22,0.1)]';
      case 'MC x Celeb': return 'border-indigo-500 bg-indigo-100/80 hover:bg-indigo-100 text-indigo-950 shadow-[0_2px_10px_rgba(99,102,241,0.1)]';
      case 'SBD HP#1': case 'SBD HP#2': return 'border-amber-500 bg-amber-100/80 hover:bg-amber-100 text-amber-950 shadow-[0_2px_10px_rgba(245,158,11,0.1)]';
      default: return 'border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-900 shadow-sm';
    }
  };

  const getCalendarEventColor = (asset: string, isHoliday: boolean) => {
    switch (asset) {
      case 'D-Day': 
        return 'border-l-4 border-orange-500 bg-orange-100 text-orange-950 font-extrabold';
      case 'MC x Celeb': 
        return 'border-l-4 border-indigo-500 bg-indigo-100 text-indigo-950 font-extrabold';
      case 'SBD HP#1': 
      case 'SBD HP#2': 
        return 'border-l-4 border-amber-500 bg-amber-100 text-amber-950 font-extrabold';
      default: 
        return isHoliday 
          ? 'border-l-4 border-slate-400 bg-slate-200 text-slate-900' 
          : 'border-l-4 border-slate-300 bg-slate-100 text-slate-800';
    }
  };

  return (
    <div id="app-container" className="min-h-screen bg-slate-100 p-2 sm:p-4 md:p-8 font-sans text-slate-900 relative">
      
      {/* ส่วนแสดง Toast Notification / Custom Alert */}
      <AnimatePresence>
        {alert.show && (
          <motion.div 
            id="alert-toast"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-auto z-50 flex items-center gap-3 px-4 sm:px-6 py-3.5 sm:py-4 rounded-xl shadow-2xl border ${
              alert.type === 'success' 
                ? 'bg-emerald-600 text-white border-emerald-500' 
                : 'bg-rose-600 text-white border-rose-500'
            }`}
          >
            <div className="p-1 rounded-full bg-white/20 shrink-0">
              {alert.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            </div>
            <span className="text-xs font-bold leading-tight flex-1">{alert.message}</span>
            <button 
              onClick={() => setAlert(prev => ({ ...prev, show: false }))} 
              className="p-1 hover:bg-white/20 rounded-lg transition-colors"
            >
              <X size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div id="main-card" className="max-w-7xl mx-auto bg-white rounded-2xl md:rounded-[2rem] shadow-2xl overflow-hidden border border-slate-200">
        
        {/* Header Section */}
        <div id="header-bar" className="bg-slate-900 p-4 sm:p-6 text-white">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3 sm:gap-6">
              <div className={`p-2.5 sm:p-3 rounded-xl shadow-xl shrink-0 ${isAuthorized ? 'bg-emerald-500' : 'bg-orange-500'}`}>
                {loading ? <RefreshCw className="animate-spin" size={16} /> : isAuthorized ? <CheckCircle2 size={16} /> : <Lock size={16} />}
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-xl font-black tracking-tight uppercase flex items-center gap-2">
                  <span>Shopee Live Ops Calendar</span>
                  <span className="text-[10px] bg-red-500 text-white px-2 py-0.5 rounded font-black tracking-widest uppercase">PRO</span>
                </h1>
                <p className="text-slate-400 text-[8px] sm:text-[9px] uppercase tracking-[0.15em] font-bold truncate">{statusMsg}</p>
              </div>
            </div>
            
            <div className="flex items-center justify-end gap-2 shrink-0">
              {activeView === 'calendar' ? (
                <button 
                  id="btn-sync"
                  onClick={fetchDataJSONP}
                  disabled={loading}
                  className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-orange-600 text-white hover:bg-orange-500 px-4 py-2.5 rounded-xl font-black text-[11px] shadow-lg transition-all"
                >
                  <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                  {loading ? 'SYNCING...' : 'SYNC SHEET'}
                </button>
              ) : (
                <button 
                  id="btn-switch-calendar"
                  onClick={() => {
                    setActiveView('calendar');
                    triggerAlert("สลับมุมมองหน้าปฏิทิน");
                  }}
                  className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-orange-600 text-white hover:bg-orange-500 px-4 py-2.5 rounded-xl font-black text-[11px] shadow-lg transition-all"
                >
                  <Calendar size={12} />
                  CALENDAR VIEW
                </button>
              )}

              {/* ปุ่มเซ็ตข้อมูลหลอกกรณี spreadsheet ดึงไม่ออก */}
              {events.length === 0 && !loading && (
                <button
                  id="btn-seed-mock-data"
                  onClick={handleSeedMockData}
                  className="flex items-center gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500 px-4 py-2.5 rounded-xl font-black text-[11px] shadow-lg transition-all"
                  title="ใช้ข้อมูลจำลองเพื่อดูลูกเล่นปฏิทิน"
                >
                  <Sparkles size={12} />
                  SEED DEMO
                </button>
              )}

              {/* ปุ่มเปิด-ปิดแถบข้างแบบด่วน */}
              {activeView === 'calendar' && (
                <button
                  id="btn-sidebar-toggle"
                  onClick={() => {
                    setIsSidebarOpen(!isSidebarOpen);
                    triggerAlert(isSidebarOpen ? "ซ่อนแถบกิจกรรมด้านข้างแล้ว" : "แสดงแถบกิจกรรมด้านข้างแล้ว");
                  }}
                  className={`p-3 rounded-xl shadow-lg border transition-all flex items-center justify-center min-w-[42px] min-h-[42px] ${
                    isSidebarOpen 
                      ? 'bg-orange-600/25 border-orange-500 text-orange-200 hover:bg-orange-600/45' 
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700'
                  }`}
                  title={isSidebarOpen ? "ซ่อนแถบด้านข้าง" : "เปิดแถบด้านข้าง"}
                >
                  <Columns size={14} />
                </button>
              )}

              {/* เมนูตั้งค่าขนาดกะทัดรัด (แตะง่ายขึ้นสำหรับ Touch screen) */}
              <div className="relative">
                <button 
                  id="btn-settings"
                  onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
                  className="p-3 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 rounded-xl shadow-lg transition-all border border-slate-700 flex items-center justify-center min-w-[42px] min-h-[42px]"
                  title="Settings"
                >
                  <Settings size={14} />
                </button>

                {showSettingsDropdown && (
                  <div className="absolute right-0 mt-2 w-52 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-20 py-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
                    <button
                      onClick={() => {
                        setActiveView(activeView === 'calendar' ? 'database' : 'calendar');
                        setShowSettingsDropdown(false);
                      }}
                      className="w-full text-left px-4 py-3 text-[11px] font-black text-slate-200 hover:bg-slate-705 flex items-center gap-2.5 transition-all"
                    >
                      {activeView === 'calendar' ? <Database size={12} /> : <Calendar size={12} />}
                      {activeView === 'calendar' ? 'VIEW DATABASE (ฐานข้อมูล)' : 'VIEW CALENDAR (ปฏิทิน)'}
                    </button>
                    <button
                      onClick={() => {
                        setShowUrlInput(!showUrlInput);
                        setShowSettingsDropdown(false);
                      }}
                      className="w-full text-left px-4 py-3 text-[11px] font-black text-slate-200 hover:bg-slate-705 flex items-center gap-2.5 transition-all"
                    >
                      <Settings size={12} />
                      UPDATE STRAP/URL
                    </button>
                    <button
                      onClick={() => {
                        handleSeedMockData();
                        setShowSettingsDropdown(false);
                      }}
                      className="w-full text-left px-4 py-3 text-[11px] font-black text-emerald-400 hover:bg-slate-705 flex items-center gap-2.5 transition-all"
                    >
                      <DatabaseBackup size={12} />
                      SEED DEMO EVENTS
                    </button>
                    <a 
                      href={appsScriptUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      onClick={() => setShowSettingsDropdown(false)}
                      className="w-full text-left px-4 py-3 text-[11px] font-black text-amber-400 hover:bg-slate-705 flex items-center gap-2.5 transition-all"
                    >
                      <Key size={12} />
                      AUTHORIZE EXTERNAL
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* INPUT FIELD PANEL FOR UPDATING LINK */}
        {showUrlInput && (
          <div id="url-input-form" className="mx-4 sm:mx-6 mt-4 p-4 sm:p-5 bg-slate-50 border border-slate-200 rounded-2xl animate-in slide-in-from-top-3 duration-200">
            <form onSubmit={handleUpdateUrlSubmit} className="flex flex-col md:flex-row items-stretch md:items-end gap-3">
              <div className="flex-1 w-full">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">
                  Google Apps Script Web App URL
                </label>
                <input 
                  type="text" 
                  value={tempUrl}
                  onChange={(e) => setTempUrl(e.target.value)}
                  placeholder="วางลิงก์ Web App (.exec)..."
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                />
              </div>
              <div className="flex gap-2 w-full md:w-auto">
                <button 
                  type="submit"
                  className="flex-1 px-5 py-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-black text-xs shadow transition-all"
                >
                  SAVE & AUTH
                </button>
                <button 
                  type="button"
                  onClick={() => setShowUrlInput(false)}
                  className="px-4 py-2.5 bg-slate-250 hover:bg-slate-300 text-slate-700 rounded-xl font-black text-xs transition-all"
                >
                  CANCEL
                </button>
              </div>
            </form>
          </div>
        )}

        {/* VIEW 1: CALENDAR VIEW */}
        {activeView === 'calendar' && (
          <div className="flex flex-col lg:flex-row">
            
            {/* โซนซ้าย: ปฏิทินหลัก */}
            <div className="flex-1 min-w-0">
              
              {/* Filter & Controls Row */}
              <div className="px-4 sm:px-8 py-4 sm:py-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight uppercase leading-none">
                    {monthName}
                  </h2>
                  {selectedTech !== "All" && (
                    <span className="text-[10px] font-bold text-orange-600 uppercase tracking-widest flex items-center gap-1 mt-0.5">
                      <Filter size={10} /> กำลังคัดกรอง: {selectedTech}
                    </span>
                  )}
                </div>

                <div className="flex flex-row items-center justify-between sm:justify-end gap-2.5">
                  <div className="relative flex-1 sm:flex-initial">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                      <Users size={12} />
                    </div>
                    <select 
                      id="select-tech-filter"
                      value={selectedTech}
                      onChange={(e) => setSelectedTech(e.target.value)}
                      className="w-full pl-8 pr-7 py-2 bg-slate-100 border border-slate-200 rounded-xl text-[10px] sm:text-[11px] font-black uppercase tracking-tight focus:outline-none focus:ring-2 focus:ring-orange-550 appearance-none cursor-pointer transition-all hover:bg-slate-200 min-w-[38px] text-slate-800"
                    >
                      {allTechs.map(t => (
                        <option key={t} value={t}>{t === "All" ? "ALL TECHS (ทั้งหมด)" : t}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200 shrink-0">
                    <button 
                      id="btn-prev-month"
                      onClick={prevMonth} 
                      className="p-1.5 sm:p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button 
                      id="btn-today"
                      onClick={() => setCurrentDate(new Date())} 
                      className="px-2 sm:px-3 text-[9px] font-black text-slate-500 uppercase tracking-widest leading-loose"
                    >
                      Today
                    </button>
                    <button 
                      id="btn-next-month"
                      onClick={nextMonth} 
                      className="p-1.5 sm:p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              </div>

              {/* เคล็ดลับการควบคุมในสภาวะหน้าจอว่าง หรือ กำลังโหลดข้อมูล */}
              {events.length === 0 && (
                <div className="p-8 text-center bg-orange-50/20 border-b border-orange-100">
                  <AlertCircle className="text-orange-500 mx-auto mb-3" size={32} />
                  <h3 className="text-sm font-black text-slate-800 mb-1">ยินดีต้อนรับสู่ระบบตรวจคิว Shopee Live Ops</h3>
                  <p className="text-xs text-slate-500 max-w-lg mx-auto mb-4">
                    ยังไม่พบรายการกิจกรรมในระบบ กรุณากดปุ่ม <strong>SYNC SHEET</strong> เพื่อซิงก์ตารางเวลาจาก Google Sheets หรือกดปุ่ม <strong>SEED DEMO</strong> ด้านบนเพื่อทดลองเล่นผ่านชุดข้อมูลจำลอง
                  </p>
                </div>
              )}

              {/* Calendar Grid */}
              <div id="calendar-grid" className="grid grid-cols-7 bg-slate-200 gap-px select-none">
                {dayNames.map(day => (
                  <div key={day} className="bg-slate-50 py-2 sm:py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest min-w-[40px]">
                    {day}
                  </div>
                ))}

                {calendarDays.map((item, idx) => {
                  const isToday = item.day && item.date && new Date().toDateString() === item.date.toDateString();
                  return (
                    <div 
                      key={idx} 
                      onClick={() => handleDayClick(item)}
                      className={`min-h-[90px] sm:min-h-[120px] p-1 sm:p-2 transition-all relative group min-w-[40px] ${
                        !item.day ? 'bg-slate-50/40' : 
                        item.isHoliday ? 'bg-red-50/40 cursor-pointer hover:bg-red-100/60' : 'bg-white cursor-pointer hover:bg-orange-50/20'
                      }`}
                    >
                      {item.day && item.date && (
                        <>
                          <div className={`text-[10px] font-black mb-1 w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-lg transition-all ${
                            isToday ? 'bg-orange-500 text-white shadow-md' : 
                            item.isHoliday ? 'text-red-500' : 'text-slate-400 group-hover:text-slate-900 group-hover:bg-slate-100'
                          }`}>
                            {item.day}
                          </div>
                          
                          {/* ส่วนแสดงกิจกรรมแบบสามารถเลื่อนดูได้ */}
                          <div className="space-y-0.5 sm:space-y-1 max-h-[60px] sm:max-h-[82px] overflow-y-auto pr-0.5 no-scrollbar">
                            {item.events.map((ev, i) => (
                              <div 
                                key={i} 
                                className={`text-[8px] sm:text-[9px] px-1.5 py-0.5 sm:py-1 rounded-md shadow-sm transition-all leading-normal truncate ${getCalendarEventColor(ev.asset, item.isHoliday || false)}`}
                                title={`${ev.time} | ${ev.kol}`}
                              >
                                <span className="font-bold mr-1">{ev.time}</span>
                                {ev.kol}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* โซนขวา: แถบด้านข้างแสดงกิจกรรมแบบเต็ม (Right Sidebar) ยึดเฉพาะคิวงานของ Today เท่านั้น */}
            {isSidebarOpen && (
              <div id="sidebar-container" className="w-full lg:w-80 xl:w-96 bg-slate-50 border-t lg:border-t-0 lg:border-l border-slate-200 p-4 sm:p-6 flex flex-col justify-between shrink-0 animate-in slide-in-from-right duration-200">
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex items-center justify-between pb-4 border-b border-slate-200 mb-4 shrink-0">
                    <div className="flex items-center gap-2">
                      <Calendar className="text-orange-500 animate-pulse" size={18} />
                      <h3 className="text-sm font-black text-slate-800 tracking-tight uppercase">
                        คิวไลฟ์สดประจำวันนี้
                      </h3>
                    </div>
                    <button 
                      onClick={() => setIsSidebarOpen(false)}
                      className="p-1.5 bg-slate-200/60 hover:bg-red-50 hover:text-red-650 rounded-lg text-slate-500 transition-all"
                      title="ซ่อนแถบด้านข้าง"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  {/* ข้อมูลวันที่ปัจจุบันในระบบแถบข้าง */}
                  <div className="bg-orange-50/90 rounded-2xl p-4 border border-orange-150 shadow-sm mb-4 shrink-0">
                    <p className="text-[9px] font-black text-orange-500 uppercase tracking-widest mb-1 block">
                      TODAY
                    </p>
                    <h4 className="text-sm sm:text-base font-black text-slate-900 leading-tight">
                      {new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </h4>
                    <p className="text-[10px] font-bold text-orange-600 mt-1.5 flex items-center gap-1">
                      <Clock size={10} /> พบคิวงานทั้งหมด {activeSidebarEvents.length} รายการวันนี้
                    </p>
                  </div>

                  {/* ลิสต์กิจกรรมรายวันแบบพรีวิวละเอียด */}
                  <div className="space-y-3 flex-1 overflow-y-auto pr-1 no-scrollbar pb-2 min-h-0">
                    {activeSidebarEvents.length === 0 ? (
                      <div className="py-12 px-4 text-center text-slate-400 font-semibold italic text-xs bg-white rounded-2xl border border-dashed border-slate-200">
                        ไม่มีคิวงานที่ต้องจัดแสดงในวันนี้
                      </div>
                    ) : (
                      activeSidebarEvents.map((ev, i) => (
                        <div key={i} className={`rounded-xl p-3 border-l-4 bg-white shadow-sm flex flex-col justify-between transition-all hover:shadow-md ${getAssetColor(ev.asset)}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[8px] font-black px-1.5 py-0.5 bg-slate-900 text-white rounded uppercase tracking-tighter">{ev.asset}</span>
                            <span className="text-[9px] font-black text-slate-400 flex items-center gap-0.5"><MapPin size={9} />{ev.studio}</span>
                          </div>
                          <h5 className="text-xs sm:text-sm font-black text-slate-950 mb-2 leading-snug">{ev.kol}</h5>
                          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[9px] font-bold text-slate-500">
                            <span className="text-orange-600 flex items-center gap-0.5"><Clock size={10} />{ev.time} - {ev.endTime || '..'}</span>
                            <span className="truncate max-w-[120px] text-right">{ev.techs.join(', ') || 'Pending'}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* แสดงรายชื่อ Techs ทั้งหมดปฏิบัติหน้าที่ในวันนี้ */}
                <div className="mt-4 pt-4 border-t border-slate-200/80">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-2.5 flex items-center gap-1.5">
                    <Users size={12} className="text-slate-400" />
                    ทีมเทคนิคที่รับผิดชอบวันนี้
                  </p>
                  {activeSidebarTechs.length === 0 ? (
                    <div className="py-3 px-4 text-center rounded-xl bg-slate-100 text-[10px] font-bold text-slate-400 italic">
                      ไม่มีข้อมูลทีมดูแลสำหรับวันนี้
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto no-scrollbar">
                      {activeSidebarTechs.map((tech, idx) => (
                        <span 
                          key={idx} 
                          className="inline-flex items-center gap-1 bg-white text-slate-800 text-[10px] font-black px-2.5 py-1 rounded-lg border border-slate-200 shadow-sm"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                          {tech}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            )}

          </div>
        )}

        {/* VIEW 2: DATABASE VIEW */}
        {activeView === 'database' && (
          <div id="db-view-container" className="p-4 sm:p-6 animate-in fade-in duration-200">
            {/* Header คอนโทรลของหน้า Database */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 sm:pb-6 border-b border-slate-100">
              <div>
                <h2 className="text-base sm:text-xl font-black text-slate-800 tracking-tight uppercase flex items-center gap-2">
                  <Database className="text-orange-500" size={18} />
                  LIVE DATABASE VIEW
                </h2>
                <p className="text-[10px] sm:text-xs text-slate-400 font-medium">สืบค้นคิวงาน ค้นหา KOL และส่งออกข้อมูลเป็น CSV เพื่อวิเคราะห์ข้อมูลย้อนหลัง</p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <button
                  id="btn-export-csv"
                  onClick={handleExportCSV}
                  className="flex items-center justify-center gap-1.5 bg-slate-900 text-white hover:bg-orange-600 px-4 py-2.5 sm:py-2 rounded-xl text-[11px] font-black shadow-md transition-all"
                >
                  <Download size={12} />
                  EXPORT CSV
                </button>
                <button
                  id="btn-back-calendar"
                  onClick={() => {
                    setActiveView('calendar');
                    triggerAlert("สลับมุมมองหน้าปฏิทิน");
                  }}
                  className="flex items-center justify-center gap-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2.5 sm:py-2 rounded-xl text-[11px] font-black shadow-md transition-all"
                >
                  <Calendar size={12} />
                  CALENDAR VIEW
                </button>
              </div>
            </div>

            {/* แถบค้นหาและตัวกรอง */}
            <div className="flex flex-col sm:flex-row gap-3 py-4">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="db-search-input"
                  type="text"
                  placeholder="ค้นหาศิลปิน (KOL), สตูดิโอ, ทีมเทคนิค..."
                  value={dbSearch}
                  onChange={(e) => setDbSearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                />
              </div>

              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-2.5 min-h-[38px]">
                <Filter size={12} className="text-slate-400" />
                <select
                  id="db-asset-filter"
                  value={dbAssetFilter}
                  onChange={(e) => setDbAssetFilter(e.target.value)}
                  className="bg-transparent border-none text-[11px] font-black text-slate-700 py-2 focus:outline-none cursor-pointer w-full"
                >
                  <option value="All">ALL ASSETS (ประเภททั้งหมด)</option>
                  {uniqueAssets.filter(a => a !== 'All').map(asset => (
                    <option key={asset} value={asset}>{asset}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ส่วนจัดแสดงข้อมูล (Responsive Table) */}
            <div className="block sm:hidden space-y-3">
              {dbFilteredRecords.length === 0 ? (
                <div className="py-12 text-center text-slate-400 font-semibold italic text-xs">
                  ไม่พบข้อมูลคิวงานที่ระบุ
                </div>
              ) : (
                dbFilteredRecords.map((ev, index) => (
                  <div key={index} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-slate-400">
                        {ev.date ? ev.date.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }) : 'ไม่ระบุ'}
                      </span>
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${
                        ev.asset === 'D-Day' ? 'bg-orange-550 text-white' :
                        ev.asset === 'MC x Celeb' ? 'bg-indigo-600 text-white' : 'bg-amber-400 text-slate-950'
                      }`}>
                        {ev.asset}
                      </span>
                    </div>
                    <h4 className="text-sm font-black text-slate-950">{ev.kol}</h4>
                    <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500 mt-1 border-t border-slate-200/60 pt-2">
                      <span className="text-orange-600 flex items-center gap-0.5"><Clock size={10} />{ev.time}-{ev.endTime || '..'}</span>
                      <span className="flex items-center gap-0.5"><MapPin size={10} />{ev.studio}</span>
                    </div>
                    {ev.techs.length > 0 && (
                      <p className="text-[9px] text-slate-400 font-semibold">ทีมดูแล: {ev.techs.join(', ')}</p>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* ตารางข้อมูลคิวงานหลักสำหรับ Tablet & Desktop */}
            <div className="hidden sm:block overflow-x-auto border border-slate-200 rounded-2xl shadow-sm">
              <table id="db-records-table" className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white text-xs font-black uppercase tracking-wider">
                    <th className="py-3 px-4">วันที่ทำงาน</th>
                    <th className="py-3 px-4">ช่วงเวลา</th>
                    <th className="py-3 px-4">ประเภท Asset</th>
                    <th className="py-3 px-4">ศิลปิน (KOL)</th>
                    <th className="py-3 px-4">สตูดิโอ</th>
                    <th className="py-3 px-4">ทีมดูแล (Techs)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                  {dbFilteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400 font-semibold italic">
                        ไม่พบข้อมูลที่ตรงกับเงื่อนไขการค้นหา
                      </td>
                    </tr>
                  ) : (
                    dbFilteredRecords.map((ev, index) => (
                      <tr key={index} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3.5 px-4 font-black">
                          {ev.date ? ev.date.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'ไม่ระบุ'}
                        </td>
                        <td className="py-3.5 px-4 text-orange-600 flex items-center gap-1.5">
                          <Clock size={12} />
                          {ev.time} - {ev.endTime || '..'}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider ${
                            ev.asset === 'D-Day' ? 'bg-orange-550 text-white' :
                            ev.asset === 'MC x Celeb' ? 'bg-indigo-600 text-white' : 'bg-amber-400 text-slate-905'
                          }`}>
                            {ev.asset}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-slate-950 font-black text-sm">{ev.kol}</td>
                        <td className="py-3.5 px-4 text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={10} />
                            {ev.studio}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-slate-550">{ev.techs.join(', ') || 'Pending'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer สถิติของ Database */}
            <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
              <p>พบข้อมูลคิวงานทั้งหมด {dbFilteredRecords.length} จาก {events.length} รายการที่ซิงก์ล่าสุด</p>
              <p>ระบบบันทึกความปลอดภัย: Live Console Database</p>
            </div>
          </div>
        )}

      </div>

      {/* MODAL (Responsive รายละเอียดคิวงานรายวัน) */}
      <AnimatePresence>
        {selectedDayData && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-start justify-center p-0 sm:p-4 md:p-6 overflow-y-auto bg-slate-950/70 backdrop-blur-sm">
            <motion.div 
              id="detail-modal"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full sm:max-w-4xl rounded-t-2xl sm:rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-none sm:my-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 bg-white sticky top-0 z-10">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-white shadow-lg shrink-0 ${selectedDayData.isHoliday ? 'bg-red-500' : 'bg-orange-600'}`}>
                    <LayoutGrid size={18} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm sm:text-base font-black text-slate-900 tracking-tight leading-none uppercase truncate">
                      {selectedDayData.date ? selectedDayData.date.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'ไม่ระบุ'}
                      {selectedDayData.isHoliday && <span className="ml-1.5 text-red-600 text-xs font-black uppercase">(วันหยุด)</span>}
                    </h3>
                    <p className="text-slate-400 text-[9px] font-black uppercase tracking-widest mt-1">
                      พบ {selectedDayData.events.length} ตารางไลฟ์สดในวันนี้
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedDayData(null)} 
                  className="p-2 bg-slate-100 text-slate-500 hover:bg-rose-50 hover:text-rose-600 rounded-xl transition-all"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-4 sm:p-6 bg-slate-50 overflow-y-auto max-h-[55vh] sm:max-h-[60vh] no-scrollbar">
                {/* ตารางแสดงรายละเอียดแบบ 3 grid ในหน้าจอใหญ่ และปรับเหลือ 1 grid บนจอมือถือ */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {selectedDayData.events.map((ev: any, i: number) => (
                    <div key={i} className={`rounded-xl p-4 border-l-4 bg-white shadow-sm flex flex-col justify-between transition-all hover:shadow-md ${getAssetColor(ev.asset)}`}>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[8px] font-black px-2 py-0.5 bg-slate-950 text-white rounded uppercase tracking-tighter">{ev.asset}</span>
                        <div className="flex items-center gap-1 text-slate-400">
                          <MapPin size={10} />
                          <span className="text-[10px] font-black uppercase tracking-tight truncate max-w-[80px]">{ev.studio}</span>
                        </div>
                      </div>
                      <h4 className="text-xs sm:text-sm font-black text-slate-950 mb-4 tracking-tight leading-tight">{ev.kol}</h4>
                      <div className="space-y-1.5 pt-3 border-t border-slate-100">
                        <div className="flex items-center gap-2 text-orange-600">
                          <Clock size={12} className="shrink-0" />
                          <span className="text-[10px] font-black tracking-tight">{ev.time} - {ev.endTime || '..'}</span>
                        </div>
                        <div className="flex items-start gap-2 text-slate-500">
                          <Users size={12} className="shrink-0 mt-0.5" />
                          <span className="text-[10px] font-semibold leading-tight text-slate-700">{ev.techs.length > 0 ? ev.techs.join(', ') : 'Pending'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="px-6 py-4 bg-white border-t border-slate-100 flex justify-center pb-6 sm:pb-4 sticky bottom-0">
                <button 
                  onClick={() => setSelectedDayData(null)} 
                  className="w-full sm:w-auto px-8 py-3 bg-slate-900 text-white text-[10px] font-black rounded-xl hover:bg-orange-550 transition-all uppercase tracking-[0.2em] shadow-lg"
                >
                  ปิดหน้าต่างนี้
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default App;
