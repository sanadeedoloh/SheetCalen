import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";
import firebaseConfig from "./firebase-applet-config.json";
import webPush from "web-push";

// Initialize Firebase configuration for backend server
const app = express();
const PORT = 3000;

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
const appId = "2a9298a1-b753-4533-a9bf-062dc1686552";

// VAPID keys state
let vapidKeys = {
  publicKey: "",
  privateKey: ""
};

const initializeVapidKeys = async () => {
  try {
    const sDocRef = doc(db, 'artifacts', appId, 'scheduler', 'state');
    const sSnap = await getDoc(sDocRef);
    if (sSnap.exists() && sSnap.data().publicKey && sSnap.data().privateKey) {
      vapidKeys.publicKey = sSnap.data().publicKey;
      vapidKeys.privateKey = sSnap.data().privateKey;
      await addServerSessionLog("⚙️ Loaded existing Web Push VAPID keys from Firestore");
    } else {
      // Generate standard VAPID keys
      const keys = webPush.generateVAPIDKeys();
      vapidKeys.publicKey = keys.publicKey;
      vapidKeys.privateKey = keys.privateKey;
      
      // Save keys to Firestore so they are secure and persistent
      await setDoc(sDocRef, {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey
      }, { merge: true });
      await addServerSessionLog("🔑 New Web Push VAPID keys generated and persisted to stable Firestore");
    }
    
    // Set VAPID details for web-push
    webPush.setVapidDetails(
      "mailto:developer@manpower-calendar.applet",
      vapidKeys.publicKey,
      vapidKeys.privateKey
    );
  } catch (err: any) {
    console.error("Vapid initialization error:", err);
    await addServerSessionLog(`[ERROR] Vapid Key initialization failed: ${err.message}`);
  }
};


// JSON body parsing middleware
app.use(express.json());

// In-Memory Server Diagnostics Logs
const serverSessionLogs: { id: string; message: string; timestamp: string }[] = [
  { id: "log_init", message: "Backend Cron Scheduler (แบบที่ 2) initialized successfully on Cloud Server", timestamp: new Date().toISOString() }
];

const addServerSessionLog = async (message: string) => {
  const newLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
    message,
    timestamp: new Date().toISOString()
  };
  serverSessionLogs.unshift(newLog);
  if (serverSessionLogs.length > 50) serverSessionLogs.pop();

  // Also perist the logs to Firebase so they can be viewed in real-time across devices
  try {
    const logDocRef = doc(db, 'artifacts', appId, 'scheduler', 'state');
    const docSnap = await getDoc(logDocRef);
    const existingLogs = docSnap.exists() ? (docSnap.data().activityLogs || []) : [];
    await setDoc(logDocRef, {
      activityLogs: [newLog, ...existingLogs].slice(0, 40),
      lastCheck: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.error("Failed to write scheduler logs to Firestore:", err);
  }
};

// Scheduler Storage for notified elements to prevent duplicate notifications during the hourly window
const notifiedReminders = new Set<string>();

// Helper to precisely manage Thailand Timezone components (UTC+7)
const getThailandTimeComponents = (date: Date) => {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const formatted = formatter.format(date);
  // Replace ', ' with ' ' to safely normalize any Node runtime environment variations
  const cleanFormatted = formatted.replace(', ', ' ');
  const parts = cleanFormatted.split(' ');
  const datePart = parts[0];
  const timePart = parts[1];
  const [hours, minutes] = timePart.split(':');
  return { dateString: datePart, hours, minutes };
};

const getThailandTodayString = (): string => {
  return getThailandTimeComponents(new Date()).dateString;
};

const getThailandDateString = (dateInput: string): string => {
  if (!dateInput) return "";
  // If it is a full ISO datetime containing Time/Zone or ending with Z
  if (dateInput.includes('T') || dateInput.includes(':') || dateInput.includes('Z')) {
    const parsedDate = new Date(dateInput);
    if (!isNaN(parsedDate.getTime())) {
      return getThailandTimeComponents(parsedDate).dateString;
    }
  }
  // Safe fallback for standard YYYY-MM-DD
  return dateInput;
};

const parseThailandDateTime = (dateStr: string, timeStr: string): Date => {
  const cleanDateStr = getThailandDateString(dateStr);
  let [hours, minutes] = timeStr.trim().split(':');
  hours = hours.padStart(2, '0');
  minutes = minutes.padStart(2, '0');
  // Combine date and time as Asia/Bangkok timezone offset (+07:00)
  const isoString = `${cleanDateStr}T${hours}:${minutes}:00+07:00`;
  return new Date(isoString);
};

// Core Background Task matching calendar events and subscriptions
let tempSimulatedEvents: any[] = [];

// Cleanup previously injected dummy events from Firebase Firestore to restore pristine database
const cleanupLegacyInjectedEvents = async () => {
  try {
    const stateDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'live_calendar', 'state');
    const docSnap = await getDoc(stateDocRef);
    if (docSnap.exists()) {
      const events: any[] = docSnap.data().events || [];
      const cleanedEvents = events.filter((ev: any) => ev.kol !== "Simulated Celeb" && ev.id < 9999);
      if (events.length !== cleanedEvents.length) {
        await setDoc(stateDocRef, {
          events: cleanedEvents,
          lastModified: new Date().toISOString()
        }, { merge: true });
        await addServerSessionLog("🧹 Automatic Database Cleanup: Successfully removed legacy simulated events from Firebase Firestore state");
      }
    }
  } catch (err: any) {
    console.error("Cleanup legacy simulated events failed:", err);
  }
};

// Run database cleanup once server starts
setTimeout(cleanupLegacyInjectedEvents, 5000);

const sendWebPushNotification = async (pushSub: any, title: string, body: string) => {
  try {
    const payload = JSON.stringify({
      title,
      body,
      tag: "live-stream-reminder",
      url: "/"
    });
    
    await webPush.sendNotification(pushSub, payload);
    return true;
  } catch (error: any) {
    if (error.statusCode === 410 || error.statusCode === 404) {
      await addServerSessionLog(`🗑️ Subscription has expired or feedback is 410. Discarding push target.`);
    } else {
      await addServerSessionLog(`⚠️ WebPush server protocol response: ${error.statusCode || error.message}`);
    }
    return false;
  }
};

const checkOneHourAdvanceCalendarEvents = async () => {
  try {
    const now = new Date();
    await addServerSessionLog(`👀 Background scheduler triggered check for events starting in approximately 1 hour`);

    // 1. Fetch Calendar state
    const stateDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'live_calendar', 'state');
    const stateDoc = await getDoc(stateDocRef);
    if (!stateDoc.exists()) {
      await addServerSessionLog(`[!] Live calendar database state was empty on Firebase. Scheduler skipped.`);
      return;
    }

    const firestoreEvents = stateDoc.data().events || [];
    // Combine real Firestore events and in-memory simulated helper events (no Firebase writes)
    const events = [...firestoreEvents, ...tempSimulatedEvents];
    
    // 2. Fetch Active Device subscriptions
    const subColRef = collection(db, 'artifacts', appId, 'subscriptions');
    const subSnapshot = await getDocs(subColRef);
    const subscriptions: any[] = [];
    subSnapshot.forEach(docSnap => {
      subscriptions.push(docSnap.data());
    });

    if (events.length === 0) {
      await addServerSessionLog(`[!] No calendar events found in system. State is empty.`);
      return;
    }
    if (subscriptions.length === 0) {
      await addServerSessionLog(`[i] No active user subscriptions stored on Firestore. Skipping dispatch.`);
      return;
    }

    let matchCount = 0;

    // 3. Scan events in Thailand Time zone
    const thailandToday = getThailandTodayString();
    
    events.forEach(async (event: any) => {
      // Verify event matches Thailand's Current Today Date
      const cleanEventDate = getThailandDateString(event.date);
      if (cleanEventDate !== thailandToday) return;

      // Extract hours/minutes of event starting
      if (!event.time || !event.time.includes(':')) return;

      const eventStart = parseThailandDateTime(event.date, event.time);
      if (isNaN(eventStart.getTime())) return;

      const diffInMinutes = (eventStart.getTime() - now.getTime()) / 60000;
      
      // Approximately 1 hour advance notification (within 55 to 65 minutes)
      const isWithinWindow = diffInMinutes >= 55 && diffInMinutes <= 65;
      const reminderKey = `server_1hr_${event.id}_${eventStart.getTime()}`;

      if (isWithinWindow) {
        if (!notifiedReminders.has(reminderKey)) {
          notifiedReminders.add(reminderKey);
          matchCount++;
          
          await addServerSessionLog(`📢 Match found: Live event content matches 1hr reminder window: [KOL: ${event.kol} / Time: ${event.time}]`);

          // Deliver notifications dynamically to matched subscribers
          subscriptions.forEach(async (sub) => {
            if (!sub.enableMobilePush) return;

            const matchedTechs = event.techs.filter((t: string) => sub.selectedTechs?.includes(t));
            if (matchedTechs.length > 0) {
              const title = "อย่าลืมน่ะอีก 1 ชั่วโมงมีไลฟ์";
              const body = `เวลา ${event.time} - ${event.endTime || '--:--'}\nCELEB : ${event.kol}\nTECH : ${event.techs.join(', ')}`;

              // Dispatch the alert doc inside the device's subcollection
              const latestAlertDocRef = doc(db, 'artifacts', appId, 'subscriptions', sub.deviceId, 'alerts', 'latest');
              await setDoc(latestAlertDocRef, {
                id: `srv_alert_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                title,
                body,
                timestamp: new Date().toISOString(),
                eventKol: event.kol,
                matchedTechs
              });

              await addServerSessionLog(`🚀 Dispatch Push Alert to Device Model: "${sub.deviceName}" (Matched Techs: ${matchedTechs.join(', ')})`);

              // Directly send Web Push (VAPID) if subscription registration exists
              if (sub.webPushSubscription) {
                try {
                  const pushSub = typeof sub.webPushSubscription === 'string'
                    ? JSON.parse(sub.webPushSubscription)
                    : sub.webPushSubscription;
                  await sendWebPushNotification(pushSub, title, body);
                  await addServerSessionLog(`⚡ [WebPush] Delivered native push notification directly to OS of device "${sub.deviceName}"!`);
                } catch (pushErr: any) {
                  console.error("WebPush JSON parse or deliver failed:", pushErr);
                  await addServerSessionLog(`⚠️ Failed parsing webPushSubscription for "${sub.deviceName}": ${pushErr.message}`);
                }
              }
            }
          });
        }
      }
    });

    if (matchCount === 0) {
      await addServerSessionLog(`✔️ Server check finished. No events inside the 1-hour window matched. Status: Active`);
    }

  } catch (err: any) {
    console.error("Error in server scheduler check:", err);
    await addServerSessionLog(`[ERROR] Background task crashed: ${err.message || err}`);
  }
};

// Start Background interval (Run VAPID key initialization first and then check every 30 seconds)
addServerSessionLog("Initializing Scheduler background monitor loops...");
setTimeout(async () => {
  await initializeVapidKeys();
  checkOneHourAdvanceCalendarEvents();
  setInterval(checkOneHourAdvanceCalendarEvents, 30000);
}, 2000);

// API Route: Get VAPID public key for Web Push client subscription
app.get("/api/push/public-key", (req, res) => {
  res.json({
    success: true,
    publicKey: vapidKeys.publicKey
  });
});

// API Route: Get state of server diagnostics & schedulers
app.get("/api/scheduler/status", async (req, res) => {
  try {
    const subColRef = collection(db, 'artifacts', appId, 'subscriptions');
    const subSnapshot = await getDocs(subColRef);
    
    res.json({
      success: true,
      mode: "Server-Side Push Scheduler (แบบที่ 2)",
      status: "Running - Active",
      lastCheckTime: new Date().toISOString(),
      activeSubscriptionsCount: subSnapshot.size,
      memoryTrackedReminders: Array.from(notifiedReminders)
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API Route: Trigger manual cron run for simulation/testing
app.post("/api/scheduler/simulate-run", async (req, res) => {
  await addServerSessionLog("⚡ Manual trigger requested for Server-Side Scheduler Check");
  await checkOneHourAdvanceCalendarEvents();
  res.json({
    success: true,
    message: "Background scheduler process was forced to run successfully.",
    time: new Date().toISOString()
  });
});

// API Route: Simulate scanning for the nearest upcoming event and calculating countdown remaining
app.post("/api/scheduler/simulate-event", async (req, res) => {
  try {
    const now = new Date();
    await addServerSessionLog(`🎮 Event Scan Simulator triggered: Searching for the nearest upcoming scheduled live stream event...`);
    
    // 1. Read real events from the Firestore calendar state
    const stateDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'live_calendar', 'state');
    const docSnap = await getDoc(stateDocRef);
    const events = docSnap.exists() ? (docSnap.data().events || []) : [];

    let nearestEvent: any = null;
    let minDiffMs = Infinity;
    let isMocked = false;

    // Filter and identify the nearest upcoming event in the database in Thailand timezone
    events.forEach((event: any) => {
      if (!event.date || !event.time) return;
      
      const eventStart = parseThailandDateTime(event.date, event.time);
      if (isNaN(eventStart.getTime())) return;
      
      const diffMs = eventStart.getTime() - now.getTime();
      
      // Determine the closest event in the future
      if (diffMs > 0 && diffMs < minDiffMs) {
        minDiffMs = diffMs;
        nearestEvent = event;
      }
    });

    // If there is no upcoming event in the real database, dynamically mock one with a countdown of 2 hours and 15 minutes
    if (!nearestEvent) {
      isMocked = true;
      minDiffMs = (2 * 60 * 60 * 1000) + (15 * 60 * 1000); // 2h 15m
      
      const targetTimeInThailand = new Date(now.getTime() + minDiffMs);
      const { dateString, hours, minutes } = getThailandTimeComponents(targetTimeInThailand);

      nearestEvent = {
        id: 8888,
        date: dateString,
        asset: "Shopee Live Premium",
        time: `${hours}:${minutes}`,
        endTime: `${(parseInt(hours) + 1) % 24}:${minutes}`,
        kol: "KOL Preawah (จำลองงานถัดไป)",
        studio: "Studio 1 (จำลอง)",
        techs: ["Dee", "Geng"]
      };

      await addServerSessionLog(`💡 No upcoming calendar events found in Firestore. Creating dummy countdown target: KOL ${nearestEvent.kol} in 2 hrs 15 mins.`);
    }

    const hoursLeft = Math.floor(minDiffMs / (1000 * 60 * 60));
    const minutesLeft = Math.floor((minDiffMs % (1000 * 60 * 60)) / (1000 * 60));

    const titleStr = isMocked ? "⏰ ตรวจพบนัดใกล้ที่สุด (โหมดจำลอง)" : "⏰ ตรวจพบดีเลย์แจ้งงานล่วงหน้าที่ใกล้ที่สุดสำเร็จ";
    const bodyStr = `งานถัดไป: [KOL: ${nearestEvent.kol} | TECH: ${nearestEvent.techs.join(', ')}]\nเริ่มในอีก ${hoursLeft} ชั่วโมง ${minutesLeft} นาที (เวลา ${nearestEvent.time})`;

    await addServerSessionLog(`🎯 Simulator: Nearest event is [KOL: ${nearestEvent.kol}] at ${nearestEvent.time}. Remaining: ${hoursLeft} hr ${minutesLeft} min.`);

    // 2. Fetch active subscriptions to notify devices dynamically
    const subColRef = collection(db, 'artifacts', appId, 'subscriptions');
    const subSnapshot = await getDocs(subColRef);
    let deviceDispatchedCount = 0;

    subSnapshot.forEach(async (docSnap) => {
      const sub = docSnap.data();
      if (!sub.enableMobilePush) return;

      // Ensure target device has matched technicians (or deliver if mocked)
      const matchedTechs = isMocked 
        ? ["Dee"] 
        : nearestEvent.techs.filter((t: string) => sub.selectedTechs?.includes(t));

      if (isMocked || matchedTechs.length > 0) {
        deviceDispatchedCount++;
        const latestAlertDocRef = doc(db, 'artifacts', appId, 'subscriptions', sub.deviceId, 'alerts', 'latest');
        
        await setDoc(latestAlertDocRef, {
          id: `srv_alert_${Date.now()}_nearest_${Math.random().toString(36).substring(2, 6)}`,
          title: titleStr,
          body: bodyStr,
          timestamp: new Date().toISOString(),
          eventKol: nearestEvent.kol,
          matchedTechs: isMocked ? ["Dee", "Geng"] : matchedTechs
        });

        await addServerSessionLog(`🚀 Dispatch Countdown Alert to Device Model "${sub.deviceName}" for upcoming live (Remaining: ${hoursLeft} hr ${minutesLeft} min)`);

        // Also deliver standard Web Push (VAPID) if enabled
        if (sub.webPushSubscription) {
          try {
            const pushSub = typeof sub.webPushSubscription === 'string'
              ? JSON.parse(sub.webPushSubscription)
              : sub.webPushSubscription;
            await sendWebPushNotification(pushSub, titleStr, bodyStr);
            await addServerSessionLog(`⚡ [Simulation-WebPush] Dispatched push immediately to "${sub.deviceName}"`);
          } catch (err: any) {
            console.error("Simulation WebPush failed:", err);
          }
        }
      }
    });

    res.json({
      success: true,
      message: "Successfully calculated nearest upcoming event countdown",
      nearestEvent,
      countdown: {
        hours: hoursLeft,
        minutes: minutesLeft,
        formatted: `${hoursLeft} ชั่วโมง ${minutesLeft} นาที`
      },
      devicesNotified: deviceDispatchedCount,
      isMocked
    });

  } catch (error: any) {
    console.error("Simulation error in server-side nearest search:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve frontend build static files / Development config as requested
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Express Backend] Server-Side Push Scheduler listening at http://localhost:${PORT}`);
  });
}

startServer();
