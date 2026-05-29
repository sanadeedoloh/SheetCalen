import React, { useState, useEffect, useMemo } from 'react';
import { 
  ChevronLeft, ChevronRight, RefreshCw, Lock, 
  CheckCircle2, Clock, X, MapPin, LayoutGrid, Users, Filter, Key,
  Settings, AlertCircle, Search, Download, Calendar, Database,
  Columns, SlidersHorizontal, Bell, BellRing, BellOff, Smartphone, History
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
  getDoc,
  onSnapshot
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
  
  // สถานะตัวกรองขั้นสูง (Advanced Filters)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(false);
  const [advAsset, setAdvAsset] = useState<string>('All');
  const [advKol, setAdvKol] = useState<string>('');
  const [advStudio, setAdvStudio] = useState<string>('All');
  const [advTime, setAdvTime] = useState<string>('');
  
  const [selectedDayData, setSelectedDayData] = useState<any | null>(null);

  // สถานะเครื่องประยุกต์และการแจ้งเตือนผ่าน Firebase
  const [showNotificationModal, setShowNotificationModal] = useState<boolean>(false);
  const [notificationEnabled, setNotificationEnabled] = useState<boolean>(false);
  const [subscribedTechs, setSubscribedTechs] = useState<string[]>([]);
  const [permState, setPermState] = useState<string>(() => {
    if ('Notification' in window) {
      return (window as any).Notification.permission;
    }
    return 'unsupported';
  });
  const [deviceName, setDeviceName] = useState<string>(() => {
    const isMobile = navigator.userAgent.includes('Mobile') || navigator.userAgent.includes('Android') || navigator.userAgent.includes('iPhone');
    return `${isMobile ? 'Mobile' : 'Desktop'} Device (${window.screen.width}x${window.screen.height})`;
  });
  const [deviceId] = useState<string>(() => {
    let id = localStorage.getItem('manpower_device_id');
    if (!id) {
      id = 'dev_' + Math.random().toString(36).substring(2, 10);
      localStorage.setItem('manpower_device_id', id);
    }
    return id;
  });
  
  // ประวัติการแจ้งเตือนจำลองและจริงในแอพพลิเคชัน
  const [notificationLog, setNotificationLog] = useState<{ id: string; title: string; body: string; time: string }[]>([]);

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

  const isNotifEnabledRef = React.useRef<boolean>(false);
  const subTechsRef = React.useRef<string[]>([]);
  const previousEventsRef = React.useRef<CalendarEvent[]>([]);
  const isFirstLoadRef = React.useRef<boolean>(true);

  useEffect(() => {
    isNotifEnabledRef.current = notificationEnabled;
  }, [notificationEnabled]);

  useEffect(() => {
    subTechsRef.current = subscribedTechs;
  }, [subscribedTechs]);

  // ระบบส่งแจ้งเตือนในเครื่องเบราว์เซอร์หรือมือถือ
  const showSystemNotification = (title: string, body: string) => {
    const logTime = new Date().toLocaleTimeString('th-TH');
    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5);
    setNotificationLog(prev => [{ id: logId, title, body, time: logTime }, ...prev].slice(0, 55));

    if (!('Notification' in window) || (window as any).Notification.permission !== 'granted') {
      return;
    }

    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(title, {
            body,
            icon: '/icon-512.png',
            badge: '/icon-512.png',
            vibrate: [200, 100, 200],
            tag: 'manpower-alert',
            renotify: true
          } as any);
        }).catch(() => {
          new (window as any).Notification(title, { body, icon: '/icon-512.png' });
        });
      } else {
        new (window as any).Notification(title, { body, icon: '/icon-512.png' });
      }
    } catch (e) {
      console.warn("Could not fire system notification:", e);
    }
  };

  // ตรวจสอบและเปรียบเทียบข้อมูลเพื่อแจ้งเตือนเมื่อตรวจพบคิวงานอัปเดต
  const checkAndTriggerNotifications = (oldEvs: CalendarEvent[], newEvs: CalendarEvent[]) => {
    if (!oldEvs || oldEvs.length === 0) return;

    newEvs.forEach(newEvent => {
      const oldEvent = oldEvs.find(o => o.id === newEvent.id);
      
      // กรณี 1: เพิ่มคิวงานเข้ามาใหม่
      if (!oldEvent) {
        const matchedTechs = newEvent.techs.filter(t => subTechsRef.current.includes(t));
        if (matchedTechs.length > 0) {
          showSystemNotification(
            `🚀 เพิ่มคิวงานใหม่: ${newEvent.kol}`,
            `ทีมงานของคุณ: ${matchedTechs.join(', ')}\nเวลา: ${formatTime(newEvent.time)} - ${formatTime(newEvent.endTime)} (${newEvent.studio})`
          );
        }
      } 
      // กรณี 2: คิวงานเดิมถูกปรับปรุงแก้ไข
      else {
        const isDetailsChanged = 
          oldEvent.kol !== newEvent.kol ||
          oldEvent.asset !== newEvent.asset ||
          oldEvent.studio !== newEvent.studio ||
          oldEvent.time !== newEvent.time ||
          oldEvent.endTime !== newEvent.endTime ||
          JSON.stringify(oldEvent.techs) !== JSON.stringify(newEvent.techs);

        if (isDetailsChanged) {
          const matchedTechs = newEvent.techs.filter(t => subTechsRef.current.includes(t));
          if (matchedTechs.length > 0) {
            showSystemNotification(
              `🔔 อัปเดตคิวงาน: ${newEvent.kol}`,
              `ประเภท: ${newEvent.asset} | ${formatTime(newEvent.time)} - ${formatTime(newEvent.endTime)}\nทีมงานที่แจ้งเตือน: ${matchedTechs.join(', ')}`
            );
          }
        }
      }
    });
  };

  // ทดสอบแจ้งเตือนจำลองส่งตรงเข้าเครื่อง
  const triggerDemoNotification = () => {
    if (!('Notification' in window)) {
      triggerAlert("เบราว์เซอร์เครื่องนี้ไม่สนับสนุนการแจ้งเตือนพุช", "error");
      return;
    }
    
    if ((window as any).Notification.permission !== 'granted') {
      triggerAlert("กรุณากดเปิดสิทธิ์รับแจ้งเตือนที่ปุ่มอนุญาตสิทธิ์ก่อนเพื่อทำการทดสอบ", "error");
      return;
    }

    triggerAlert("เริ่มจำลองการอัปเดต: ระบบจะส่งทดสอบการแจ้งเตือนเข้าเครื่องใน 2 วินาที...", "success");
    setTimeout(() => {
      showSystemNotification(
        "⚡️ จำลองแจ้งเตือน: ตารางงาน ManPower มีการเปลี่ยนแปลง",
        `รายละเอียด: มีการจำลองการเปลี่ยนตารางในฐานข้อมูลกลาง เพื่อส่งข้อมูลถึงเครื่องเป้าหมายที่เปิดรับกลุ่มสารสนเทศนี้`
      );
    }, 2000);
  };

  // ขอสิทธิ์และเปิดใช้งานกับบราวเซอร์
  const requestNotifPermission = async () => {
    if (!('Notification' in window)) {
      triggerAlert("อุปกรณ์นี้ไม่รองรับการส่งการแจ้งเตือน (Notification API)", "error");
      return;
    }
    try {
      const permission = await (window as any).Notification.requestPermission();
      setPermState(permission);
      if (permission === 'granted') {
        triggerAlert("อนุญาตสิทธิ์รับข้อมูลข่าวแจ้งเตือนเรียบร้อยแล้ว!", "success");
        // เปิดใช้งานอัตโนมัติเมื่อกดสิทธิ์ผ่าน
        saveSubscriptionSettings(true, subscribedTechs, deviceName);
      } else if (permission === 'denied') {
        triggerAlert("คุณปฏิเสธสิทธิ์รับแจ้งเตือน กรุณาเปิดคืนในตั้งค่าบราวเซอร์", "error");
      }
    } catch (e) {
      console.error("Permission request error:", e);
    }
  };

  // บันทึกการตั้งค่าการแจ้งเตือนของเครื่องลงบนคลาวด์ Firebase
  const saveSubscriptionSettings = async (enabled: boolean, techs: string[], name: string) => {
    try {
      await setDoc(doc(db, 'artifacts', appId, 'subscriptions', deviceId), {
        deviceId,
        enableMobilePush: enabled,
        selectedTechs: techs,
        deviceName: name,
        lastUpdated: new Date().toISOString()
      });
      setNotificationEnabled(enabled);
      setSubscribedTechs(techs);
      setDeviceName(name);
      triggerAlert("บันทึกตารางติดตามและอัปเดตโปรไฟล์บน Firebase ปลดล็อกระบบลงเครื่องสำเร็จ!", "success");
    } catch (err) {
      console.warn("Save subscription settings collapsed:", err);
      triggerAlert("ไม่สามารถจัดเก็บสิทธิ์ลงบันทึก Firestore คลาวด์ได้", "error");
    }
  };

  // ดึงข้อมูลแคชถาวรจาก Firebase และลิงก์อัปเดตล่าสุดมาติดตั้งเมื่อโหลดแอปเสร็จแบบเรียลไทม์
  useEffect(() => {
    let unsubscribeCalendar: (() => void) | null = null;

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

      // 1.5 โหลดตัวแปรและประวัติจดจำของตัวเครื่องนี้แบบจำแนกทางเลือกเครื่องต่อเครื่อง
      try {
        const subDoc = await getDoc(doc(db, 'artifacts', appId, 'subscriptions', deviceId));
        if (subDoc.exists()) {
          const sData = subDoc.data();
          const enabled = sData.enableMobilePush || false;
          const techs = sData.selectedTechs || [];
          setNotificationEnabled(enabled);
          setSubscribedTechs(techs);
          isNotifEnabledRef.current = enabled;
          subTechsRef.current = techs;
          if (sData.deviceName) setDeviceName(sData.deviceName);
        }
      } catch (subErr) {
        console.warn("ไม่สามารถดึงประวัติการแจ้งเตือนเครื่องเดิมย้อนหลังได้:", subErr);
      }

      // 2. ดึงข้อมูลปฏิทินกลางแบบ real-time เฝ้าสังเกตการณ์อัปเดตตารางเพื่อยิงแจ้งเตือนทันที
      try {
        unsubscribeCalendar = onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'live_calendar', 'state'), (docSnap) => {
          if (docSnap.exists()) {
            const storedEvents = docSnap.data().events || [];
            const parsed = storedEvents.map((ev: any) => ({
              ...ev,
              date: new Date(ev.date)
            }));

            // ตรวจจับและเปรียบเทียบข้อมูลแจ้งเตือน (เฉพาะครั้งที่ 2 เป็นต้นไปเมื่อเกิด Snapshot ซิงก์ทับ)
            if (!isFirstLoadRef.current && isNotifEnabledRef.current && subTechsRef.current.length > 0) {
              checkAndTriggerNotifications(previousEventsRef.current, parsed);
            }

            previousEventsRef.current = parsed;
            setEvents(parsed);
            setIsAuthorized(true);
            setAuthRequired(false);
            setStatusMsg(`ซิงโครไนซ์เรียลไทม์กับสตรีมข้อมูลคลาวด์สำเร็จ (${parsed.length} รายการ)`);
            
            if (isFirstLoadRef.current) {
              triggerAlert(`เชื่อมเกตเวย์อัปเดตเรียลไทม์ (${parsed.length} คิวงาน)`, "success");
              isFirstLoadRef.current = false;
            }
          } else {
            if (isFirstLoadRef.current) {
              setStatusMsg("ยังไม่มีข้อมูลบนคลาวด์ เริ่มดาวน์โหลดสดจาก Sheets...");
              fetchDataJSONP();
              isFirstLoadRef.current = false;
            }
          }
        }, (snapErr) => {
          console.warn("การเชื่อมต่อ Real-time ขัดข้อง ระบบจะปรับปรุงรับข้อมูลจากคลิกสำรอง:", snapErr);
          if (isFirstLoadRef.current) {
            fetchDataJSONP();
            isFirstLoadRef.current = false;
          }
        });
      } catch (err) {
        console.warn("การสร้าง onSnapshot ล้มเหลว กำลังคืนรูปผ่านดึงข้อมูลตรง:", err);
        fetchDataJSONP();
      } finally {
        setLoading(false);
      }
    };

    fetchStoredData();

    return () => {
      if (unsubscribeCalendar) {
        unsubscribeCalendar();
      }
    };
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
      triggerAlert("ดึงข้อมูลจากตาราง Google Sheets ล้มเหลว โปรดตรวจสอบ URL หรือความถูกต้องของสิทธิ์สคริปต์", "error");
    };
    document.body.appendChild(script);
  };

  const allTechs = useMemo(() => {
    const techs = new Set<string>();
    events.forEach(ev => ev.techs.forEach(t => techs.add(t)));
    return ["All", ...Array.from(techs).sort()];
  }, [events]);

  // ดึงรายการสตูดิโอทั้งหมดที่มีอยู่จริงมาใช้ในคอมโบบ็อกซ์ตัวกรองขั้นสูง
  const uniqueStudios = useMemo(() => {
    const studios = new Set<string>();
    events.forEach(ev => { if (ev.studio) studios.add(ev.studio); });
    return ['All', ...Array.from(studios).sort()];
  }, [events]);

  const filteredEvents = useMemo(() => {
    let result = events;

    // 1. กรองสตาฟเทรด Tech
    if (selectedTech !== "All") {
      result = result.filter(ev => ev.techs.includes(selectedTech));
    }

    // 2. กรองประเภท Asset
    if (advAsset !== "All") {
      result = result.filter(ev => ev.asset === advAsset);
    }

    // 3. กรองชื่อศิลปิน KOL
    if (advKol.trim() !== "") {
      const kolLower = advKol.toLowerCase().trim();
      result = result.filter(ev => (ev.kol || '').toLowerCase().includes(kolLower));
    }

    // 4. กรองห้องสตูดิโอ
    if (advStudio !== "All") {
      result = result.filter(ev => ev.studio === advStudio);
    }

    // 5. กรองเวลา Live Work
    if (advTime.trim() !== "") {
      const timeLower = advTime.toLowerCase().trim();
      result = result.filter(ev => {
        const startLower = (ev.time || '').toLowerCase();
        const endLower = (ev.endTime || '').toLowerCase();
        return startLower.includes(timeLower) || endLower.includes(timeLower);
      });
    }

    return result;
  }, [events, selectedTech, advAsset, advKol, advStudio, advTime]);

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
                  <span>ManPower Calendar</span>
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

              {/* ปุ่มเปิดแผงตั้งค่าการแจ้งเตือนส่วนบุคคลของเครื่องนี้ */}
              <button
                id="btn-notifications-modal-trigger"
                onClick={() => {
                  setShowNotificationModal(true);
                  // อัปเดตสิทธิ์ปัจจุบันทุกครั้งที่เปิดดูแผง
                  if ('Notification' in window) {
                    setPermState((window as any).Notification.permission);
                  }
                }}
                className={`p-3 rounded-xl shadow-lg border transition-all flex items-center justify-center min-w-[42px] min-h-[42px] relative ${
                  notificationEnabled && subscribedTechs.length > 0
                    ? 'bg-orange-600/25 border-orange-500 text-orange-300 hover:bg-orange-600/45 hover:text-orange-200' 
                    : 'bg-slate-800 border-slate-705 text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
                title="ตั้งค่าแจ้งเตือนโทรศัพท์สแตนด์บายจำแนกเครื่อง"
              >
                {notificationEnabled && subscribedTechs.length > 0 ? (
                  <>
                    <BellRing size={14} className="animate-bounce" />
                    <span id="badge-notif-count" className="absolute -top-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-650 text-[8px] font-black text-white shrink-0 shadow border border-slate-900">
                      {subscribedTechs.length}
                    </span>
                  </>
                ) : (
                  <Bell size={14} />
                )}
              </button>

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
                  {(selectedTech !== "All" || advAsset !== "All" || advKol.trim() !== "" || advStudio !== "All" || advTime.trim() !== "") && (
                    <span className="text-[10px] font-bold text-orange-600 uppercase tracking-widest flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Filter size={10} /> กำลังคัดกรอง:
                      </span>
                      {selectedTech !== "All" && <span className="bg-orange-100 text-orange-850 px-1.5 py-0.5 rounded font-black text-[9px]">Tech: {selectedTech}</span>}
                      {advAsset !== "All" && <span className="bg-orange-100 text-orange-850 px-1.5 py-0.5 rounded font-black text-[9px]">Asset: {advAsset}</span>}
                      {advKol.trim() !== "" && <span className="bg-orange-100 text-orange-850 px-1.5 py-0.5 rounded font-black text-[9px]">KOL: {advKol}</span>}
                      {advStudio !== "All" && <span className="bg-orange-100 text-orange-850 px-1.5 py-0.5 rounded font-black text-[9px]">Studio: {advStudio}</span>}
                      {advTime.trim() !== "" && <span className="bg-orange-100 text-orange-850 px-1.5 py-0.5 rounded font-black text-[9px]">Time: {advTime}</span>}
                    </span>
                  )}
                </div>

                <div className="flex flex-row items-center justify-between sm:justify-end gap-2.5">
                  <div className="flex items-center gap-2 flex-1 sm:flex-initial">
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

                    {/* ปุ่มสำหรับเปิด/ปิดตัวกรองขั้นสูง */}
                    <button
                      id="btn-advanced-filter"
                      onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                      className={`p-2 rounded-xl border transition-all flex items-center justify-center shrink-0 ${
                        showAdvancedFilters || advAsset !== 'All' || advKol !== '' || advStudio !== 'All' || advTime !== ''
                          ? 'bg-orange-550 border-orange-550 text-white shadow-md hover:bg-orange-600' 
                          : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200 hover:text-slate-800'
                      }`}
                      title="ตัวกรองขั้นสูง (Advanced Filters)"
                    >
                      <SlidersHorizontal size={14} className={showAdvancedFilters ? 'animate-pulse' : ''} />
                    </button>
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

              {/* ส่วนขยายสำหรับการกรองขั้นสูง (Advanced Filter Expandable Panel) */}
              <AnimatePresence>
                {showAdvancedFilters && (
                  <motion.div
                    id="advanced-filters-panel"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden border-b border-slate-100 bg-slate-50/50"
                  >
                    <div className="px-4 sm:px-8 py-4 sm:py-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {/* 1. Asset Filter */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Asset (ประเภท)</label>
                        <select
                          value={advAsset}
                          onChange={(e) => setAdvAsset(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-550 cursor-pointer"
                        >
                          {uniqueAssets.map(asset => (
                            <option key={asset} value={asset}>
                              {asset === 'All' ? 'ALL ASSETS (ประเภททั้งหมด)' : asset}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* 2. KOL Name Filter */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">KOL Name (ศิลปิน)</label>
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="พิมพ์ชื่อเพื่อค้นหา..."
                            value={advKol}
                            onChange={(e) => setAdvKol(e.target.value)}
                            className="w-full px-3 py-2 pl-8 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-550"
                          />
                          <Search className="absolute left-2.5 top-2.5 text-slate-400" size={12} />
                        </div>
                      </div>

                      {/* 3. Studio Filter */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest font-black">Studio (ห้องสตูดิโอ)</label>
                        <select
                          value={advStudio}
                          onChange={(e) => setAdvStudio(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-550 cursor-pointer"
                        >
                          {uniqueStudios.map(studio => (
                            <option key={studio} value={studio}>
                              {studio === 'All' ? 'ALL STUDIOS (สตูดิโอทั้งหมด)' : studio}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* 4. Live Time Filter */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Live Time (เวลาไลฟ์)</label>
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="เช่น 11:00, 18:00 เป็นต้น"
                            value={advTime}
                            onChange={(e) => setAdvTime(e.target.value)}
                            className="w-full px-3 py-2 pl-8 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-550"
                          />
                          <Clock className="absolute left-2.5 top-2.5 text-slate-400" size={12} />
                        </div>
                      </div>
                    </div>

                    {/* ปุ่มคืนค่าตัวกรอง */}
                    {(advAsset !== 'All' || advKol !== '' || advStudio !== 'All' || advTime !== '') && (
                      <div className="px-4 sm:px-8 pb-3.5 flex justify-end">
                        <button
                          onClick={() => {
                            setAdvAsset('All');
                            setAdvKol('');
                            setAdvStudio('All');
                            setAdvTime('');
                          }}
                          className="flex items-center gap-1.5 text-[10px] font-black text-red-500 hover:text-red-650 transition-all uppercase tracking-widest"
                        >
                          <X size={11} /> ล้างตัวกรองทั้งหมด
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* เคล็ดลับการควบคุมในสภาวะหน้าจอว่าง หรือ กำลังโหลดข้อมูล */}
              {events.length === 0 && (
                <div className="p-8 text-center bg-orange-50/20 border-b border-orange-100">
                  <AlertCircle className="text-orange-500 mx-auto mb-3" size={32} />
                  <h3 className="text-sm font-black text-slate-800 mb-1">ยินดีต้อนรับสู่ระบบตรวจคิว ManPower Calendar</h3>
                  <p className="text-xs text-slate-500 max-w-lg mx-auto mb-4">
                    ยังไม่พบรายการกิจกรรมในระบบ กรุณากดปุ่ม <strong>SYNC SHEET</strong> เพื่อดึงข้อมูลคิวงานล่าสุดที่บันทึกไว้
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

                          {/* บอกจำนวน event เป็นตัวเลขเล็กๆตรงมุมขวาล่างของช่องในแต่ละวัน */}
                          {item.events.length > 0 && (
                            <div className="absolute bottom-1 right-1 bg-orange-50 text-orange-600 text-[8px] sm:text-[9.5px] font-black px-1 py-0.5 rounded border border-orange-100 shadow-xs pointer-events-none">
                              +{item.events.length}
                            </div>
                          )}
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
                  CLOSE
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: ตั้งค่าการแจ้งเตือนพุชจำแนกรายเครื่องผ่าน Firebase */}
      <AnimatePresence>
        {showNotificationModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-start justify-center p-0 sm:p-4 md:p-6 overflow-y-auto bg-slate-950/70 backdrop-blur-sm">
            <motion.div
              id="notification-setup-modal"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] sm:max-h-none sm:my-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 bg-white sticky top-0 z-10">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-orange-600 flex items-center justify-center text-white shadow-lg shrink-0">
                    <BellRing size={20} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm sm:text-base font-black text-slate-900 tracking-tight leading-none uppercase truncate">
                      ตั้งค่าการแจ้งเตือนอุปกรณ์นี้
                    </h3>
                    <p className="text-slate-400 text-[9px] font-black uppercase tracking-widest mt-1">
                      Personalized Firebase Notification Engine
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowNotificationModal(false)}
                  className="p-2 bg-slate-100 text-slate-500 hover:bg-rose-50 hover:text-rose-600 rounded-xl transition-all"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 sm:p-6 bg-slate-50 overflow-y-auto max-h-[60vh] sm:max-h-[65vh] space-y-5 scrollbar-thin">
                {/* 1. สิทธิของเบราว์เซอร์ */}
                <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-100 shadow-sm space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <h4 className="text-xs sm:text-sm font-black text-slate-900 uppercase">สิทธิการแจ้งเตือนของเบราว์เซอร์</h4>
                      <p className="text-[10px] sm:text-xs text-slate-500 font-medium">อุปกรณ์เครื่องนี้ต้องการความยินยอมในการติดตั้งการส่งข้อมูล Push Notifications ของเครื่อง</p>
                    </div>
                    {permState === 'granted' ? (
                      <span className="text-[10px] font-black bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full uppercase tracking-wider shrink-0">
                        GRANTED (อนุญาตแล้ว)
                      </span>
                    ) : permState === 'denied' ? (
                      <span className="text-[10px] font-black bg-red-100 text-red-800 px-3 py-1 rounded-full uppercase tracking-wider shrink-0">
                        DENIED (ปฏิเสธอยู่)
                      </span>
                    ) : (
                      <span className="text-[10px] font-black bg-amber-100 text-amber-800 px-3 py-1 rounded-full uppercase tracking-wider shrink-0">
                        DEFAULT (รออนุญาต)
                      </span>
                    )}
                  </div>

                  {permState !== 'granted' && (
                    <button
                      onClick={requestNotifPermission}
                      className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-[10px] font-black tracking-widest uppercase transition-all"
                    >
                      กดเพื่ออนุญาตสิทธิ์การแจ้งเตือน (ALLOW NOTIFICATION)
                    </button>
                  )}
                  {permState === 'granted' && (
                    <div className="flex items-center gap-2.5 bg-emerald-50 text-emerald-800 rounded-xl p-3 text-[10px] sm:text-xs font-semibold leading-relaxed border border-emerald-100">
                      <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                      <span>ยินดีด้วย! เบราว์เซอร์เครื่องนี้สแตนด์บายรับสตรีมแจ้งเตือนสดได้สมบูรณ์ตลอด 24 ชม. แล้ว</span>
                    </div>
                  )}
                </div>

                {/* 2. การตั้งค่าจำแนกรายเครื่อง */}
                <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-100 shadow-sm space-y-4">
                  <div className="space-y-1 flex-1">
                    <h4 className="text-xs sm:text-sm font-black text-slate-900 uppercase">ข้อมูลจำหน่ายการแจ้งเตือนในระบบคลาวด์</h4>
                    <p className="text-[10px] sm:text-xs text-slate-500 font-bold">ตั้งชื่อให้อุปกรณ์เฉพาะโทรศัพท์หรือคอมพิวเตอร์ของคุณเพื่อบันทึกลง Firestore</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Friendly Device Name</label>
                      <input
                        type="text"
                        value={deviceName}
                        onChange={(e) => setDeviceName(e.target.value)}
                        placeholder="เช่น iPhone ของนายเอ, คอมพิวเตอร์ออฟฟิศ"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-orange-550 focus:border-orange-550"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Unique Firebase Device ID</label>
                      <div className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-mono text-slate-500 flex items-center justify-between">
                        <span className="truncate mr-2">{deviceId}</span>
                        <span className="text-[8px] bg-slate-955 text-white rounded px-1.5 py-0.5 uppercase tracking-tighter shrink-0 font-black">ACTIVE</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                    <input
                      type="checkbox"
                      id="checkbox-enable-mobile-push"
                      checked={notificationEnabled}
                      disabled={permState !== 'granted'}
                      onChange={(e) => setNotificationEnabled(e.target.checked)}
                      className="h-4 w-4 text-orange-650 border-slate-200 rounded focus:ring-orange-500 cursor-pointer disabled:opacity-50"
                    />
                    <label htmlFor="checkbox-enable-mobile-push" className="text-xs font-black text-slate-750 tracking-tight uppercase cursor-pointer disabled:opacity-50 select-none">
                      เปิดระบบแจ้งเตือนเมื่อตารางงานปรับปรุงกลาง ({notificationEnabled ? 'เปิดใช้งานอยู่' : 'ปิดใช้งานอยู่'})
                    </label>
                  </div>
                </div>

                {/* 3. คัดกรอง Tech ที่สมัครต้องการติดตาม */}
                <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-100 shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div className="space-y-0.5">
                      <h4 className="text-xs sm:text-sm font-black text-slate-900 uppercase flex items-center gap-1.5 font-bold">
                        <Smartphone size={14} className="text-orange-500" /> เลือกทีม Techs ที่คุณต้องการรับแจ้งเตือน
                      </h4>
                      <p className="text-[10px] sm:text-xs text-slate-500 font-medium">ระบบจะส่งข้อความแจ้งเตือนเมื่อพบการเปลี่ยนแปลงเฉพาะทีมงานที่คุณเลือก</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => {
                          const allAvailable = allTechs.filter(t => t !== "All");
                          setSubscribedTechs(allAvailable);
                        }}
                        className="px-2 py-1 bg-slate-105 hover:bg-slate-200 text-[9px] font-black rounded uppercase tracking-wider text-slate-600 transition-all font-bold"
                      >
                        เลือกทั้งหมด
                      </button>
                      <button
                        onClick={() => setSubscribedTechs([])}
                        className="px-2 py-1 bg-slate-105 hover:bg-slate-200 text-[9px] font-black rounded uppercase tracking-wider text-slate-600 transition-all font-bold"
                      >
                        เคลียร์ทั้งหมด
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {allTechs.filter(t => t !== "All").map(techName => {
                      const isChecked = subscribedTechs.includes(techName);
                      return (
                        <button
                          key={techName}
                          onClick={() => {
                            if (isChecked) {
                              setSubscribedTechs(prev => prev.filter(t => t !== techName));
                            } else {
                              setSubscribedTechs(prev => [...prev, techName]);
                            }
                          }}
                          className={`px-3 py-2.5 rounded-xl border text-left text-xs font-bold uppercase tracking-tight flex items-center justify-between transition-all cursor-pointer ${
                            isChecked
                              ? 'bg-orange-50 border-orange-500 text-orange-950 shadow-sm font-black'
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <span className="truncate">{techName}</span>
                          <span className={`w-2 h-2 rounded-full shrink-0 ${isChecked ? 'bg-orange-600' : 'bg-slate-200'}`} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 4. กล่องเครื่องมือทดสอบประสิทธิภาพการทำงาน */}
                <div className="bg-white rounded-2xl p-4 sm:p-5 border border-orange-500/20 shadow-sm space-y-3.5 bg-orange-600/5">
                  <div className="space-y-0.5">
                    <h4 className="text-xs sm:text-sm font-black text-orange-950 uppercase font-bold">ฟังก์ชันจำลองประสิทธิภาพการเชื่อมต่อ</h4>
                    <p className="text-[10px] sm:text-xs text-slate-600 font-medium leading-relaxed">
                      กดปุ่มทดสอบเพื่อลงรับข้อความจำลองบนแผงบอร์ดและส่งตรงเข้าล็อกสกรีนเครื่องนี้ทันที โดยจะเว้นช่วงเวลา 2 วินาทีเพื่อให้สแตนด์บายล็อกหน้าจอโทรศัพท์
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={triggerDemoNotification}
                      className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-950 text-white rounded-xl text-[10px] font-black tracking-widest uppercase transition-all shadow cursor-pointer"
                    >
                      ⚡️ จำลองพุชแจ้งเตือน (TEST BANNER IN 2S)
                    </button>
                  </div>
                </div>

                {/* 5. ประวัติสิทธิ์แจ้งเตือนกิจกรรมที่เกิดจริง */}
                <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-100 shadow-sm space-y-3">
                  <h4 className="text-xs sm:text-sm font-black text-slate-900 uppercase flex items-center gap-1.5 font-bold">
                    <History size={14} className="text-slate-400" /> ประวัติแจ้งเตือนกิจกรรมที่เกิดขึ้นเครื่องนี้ (Notification Logs)
                  </h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1 no-scrollbar">
                    {notificationLog.length === 0 ? (
                      <p className="text-[10px] text-slate-400 font-black uppercase text-center py-5">ยังไม่พบบันทึกการแจ้งเตือนพุชในช่วงเวลานี้</p>
                    ) : (
                      notificationLog.map(log => (
                        <div key={log.id} className="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-1">
                          <div className="flex justify-between items-center gap-2">
                            <span className="text-[9px] font-black text-orange-600 uppercase tracking-widest">{log.title}</span>
                            <span className="text-[8px] font-black text-slate-400 font-mono">{log.time}</span>
                          </div>
                          <p className="text-[10px] text-slate-700 font-medium leading-normal">{log.body}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Action Save Footer */}
              <div className="px-5 sm:px-6 py-4 bg-white border-t border-slate-100 flex flex-col sm:flex-row gap-3.5 justify-between items-center pb-6 sm:pb-4 sticky bottom-0">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Firebase Sync Status: Secure Link</span>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => {
                      saveSubscriptionSettings(notificationEnabled, subscribedTechs, deviceName);
                      setShowNotificationModal(false);
                    }}
                    className="flex-1 sm:flex-initial px-6 py-3 bg-orange-600 text-white text-[10px] font-black rounded-xl hover:bg-orange-550 transition-all uppercase tracking-[0.2em] shadow-lg cursor-pointer"
                  >
                    SAVE & LOCK CONFIG
                  </button>
                  <button
                    onClick={() => setShowNotificationModal(false)}
                    className="px-5 py-3 bg-slate-100 text-slate-650 hover:bg-slate-205 text-[10px] font-black rounded-xl transition-all uppercase tracking-[0.2em] cursor-pointer"
                  >
                    CLOSE
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default App;
