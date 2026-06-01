import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";
import firebaseConfig from "./firebase-applet-config.json";

// Initialize Firebase configuration for backend server
const app = express();
const PORT = 3000;

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
const appId = "2a9298a1-b753-4533-a9bf-062dc1686552";

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

// Core Background Task matching calendar events and subscriptions
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

    const events = stateDoc.data().events || [];
    
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

    // 3. Scan events
    events.forEach(async (event: any) => {
      const eventDate = new Date(event.date);

      // Verify today only
      const isToday = 
        eventDate.getFullYear() === now.getFullYear() &&
        eventDate.getMonth() === now.getMonth() &&
        eventDate.getDate() === now.getDate();

      if (!isToday) return;

      // Extract hours/minutes of event starting
      if (!event.time || !event.time.includes(':')) return;
      const [hours, minutes] = event.time.split(':').map(Number);
      if (isNaN(hours) || isNaN(minutes)) return;

      const eventStart = new Date(eventDate);
      eventStart.setHours(hours, minutes, 0, 0);

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

// Start Background interval (Run immediately and then check every 30 seconds)
addServerSessionLog("Initializing Scheduler background monitor loops...");
setTimeout(() => {
  checkOneHourAdvanceCalendarEvents();
  setInterval(checkOneHourAdvanceCalendarEvents, 30000);
}, 2000);

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

// API Route: Simulate adding a dummy upcoming event starting in exactly 1 hour for testing
app.post("/api/scheduler/simulate-event", async (req, res) => {
  try {
    const now = new Date();
    const oneHourAhead = new Date(now.getTime() + 60 * 60 * 1000);
    const hourStr = oneHourAhead.getHours().toString().padStart(2, "0");
    const minStr = oneHourAhead.getMinutes().toString().padStart(2, "0");
    const simulatedTime = `${hourStr}:${minStr}`;

    await addServerSessionLog(`🎮 Test Event Injection Simulator: Creating pseudo-active live stream event at ${simulatedTime} (1 hr in advance)`);
    
    // Fetch current state
    const stateDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'live_calendar', 'state');
    const docSnap = await getDoc(stateDocRef);
    const events = docSnap.exists() ? (docSnap.data().events || []) : [];

    const simulatedEvent = {
      id: 9999 + Math.floor(Math.random() * 1000),
      date: now.toISOString().split("T")[0],
      asset: "Shopee Live Premium",
      time: simulatedTime,
      endTime: `${(oneHourAhead.getHours() + 2) % 24}:${minStr}`,
      kol: "Simulated Celeb",
      studio: "Studio 2 (Advanced)",
      techs: ["Dee", "Geng"]
    };

    // Add simulated event to events list
    const updatedEvents = [simulatedEvent, ...events];
    await setDoc(stateDocRef, {
      events: updatedEvents,
      lastModified: new Date().toISOString()
    }, { merge: true });

    await addServerSessionLog(`🎮 Event injected: ID ${simulatedEvent.id} assigned to Tech Dee & Geng. Forcing server scan...`);
    
    // Trigger check
    setTimeout(() => {
      checkOneHourAdvanceCalendarEvents();
    }, 1500);

    res.json({
      success: true,
      message: `Simulated event starting at ${simulatedTime} injected successfully. Server scheduler triggered.`,
      injectedEvent: simulatedEvent
    });
  } catch (error: any) {
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
