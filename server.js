const express = require('express');
const fetch = require('node-fetch');
const TELEGRAM_BOT_TOKEN = '8003183519:AAFn48FqRHV5zunKZNyJizU43An0jtgoy4g';
const TELEGRAM_CHAT_ID = '8159788176';
const MOTIVE_WEBHOOK_SECRET = 'Jojo';

// Motive Dashboard → Admin → Developers → +Request API Key
const MOTIVE_API_KEY = 'MOTIVE_API_KALITINGIZNI_SHU_YERGA_YOZING';

const PORT = 3000;
const TIMEZONE = 'America/New_York';
const app = express();
app.use(express.json({ limit: '1mb' }));

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const MOTIVE_API = 'https://api.gomotive.com/v1';

// Video so'rovi yuborilgan, javobini kutayotgan hodisalar shu yerda saqlanadi
// (recall request id -> voqea haqida ma'lumot)
const pendingRecalls = new Map();

// ------------------ Telegramga yuborish ------------------

async function sendTelegramMessage(text) {
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) console.error('Telegramga matn yuborishda xato:', res.status, await res.text());
  return res.ok;
}

async function sendTelegramVideo(videoUrl, caption) {
  const res = await fetch(`${TELEGRAM_API}/sendVideo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      video: videoUrl,
      caption,
      parse_mode: 'HTML',
    }),
  });
  if (!res.ok) console.error('Telegramga video yuborishda xato:', res.status, await res.text());
  return res.ok;
}

// ------------------ Motive video so'rovi ------------------

// Harsh event kelganda, o'sha voqea vaqtiga video so'raydi.
// Muvaffaqiyatli bo'lsa, recall id'ni pendingRecalls'ga yozib qo'yadi.
async function requestVideoRecall({ vehicleNumber, startTimeIso, context }) {
  if (!vehicleNumber || !startTimeIso) {
    throw new Error('vehicleNumber yoki startTimeIso yo\'q');
  }

  const res = await fetch(`${MOTIVE_API}/video_recall_requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': MOTIVE_API_KEY,
    },
    body: JSON.stringify({
      start_time: startTimeIso,
      duration: 1, // 1 daqiqalik video (regular: 1, 2 yoki 3 bo'lishi mumkin)
      vehicle_number: vehicleNumber,
      recall_type: 'regular',
      camera_positions: ['front_facing', 'driver_facing'],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Motive video recall xatosi: ${res.status} ${body}`);
  }

  const data = await res.json();
  pendingRecalls.set(String(data.id), context);
  console.log(`Video so'rov yuborildi: id=${data.id}, vehicle=${vehicleNumber}`);
}

// ------------------ Yordamchi formatlash funksiyalari ------------------

function formatTime(isoString) {
  if (!isoString) return 'Noma\'lum vaqt';
  try {
    const d = new Date(isoString);
    const time = d.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true,
      timeZone: TIMEZONE, timeZoneName: 'short',
    });
    const date = d.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', timeZone: TIMEZONE,
    });
    return `${time} ${date}`;
  } catch {
    return isoString;
  }
}

function driverName(driver, driverId) {
  if (driverId === -1) return 'Aniqlanmagan haydovchi';
  if (!driver) return 'Noma\'lum haydovchi';
  const first = driver.first_name || driver.FirstName || '';
  const last = driver.last_name || driver.LastName || '';
  return `${first} ${last}`.trim().toUpperCase() || 'Noma\'lum haydovchi';
}

function vehicleLabel(vehicle) {
  if (!vehicle) return 'Noma\'lum';
  return vehicle.number || vehicle.Number || vehicle.id || vehicle.ID || 'Noma\'lum';
}

// km/h ni mph ga o'giradi
function kphToMph(kph) {
  if (kph == null) return null;
  return Math.round(kph * 0.621371);
}

function eventTypeLabel(type) {
  const map = {
    hard_braking: 'Harsh Braking',
    harsh_braking: 'Harsh Braking',
    hard_acceleration: 'Harsh Acceleration',
    harsh_acceleration: 'Harsh Acceleration',
    hard_turn: 'Harsh Turning',
    harsh_turn: 'Harsh Turning',
    crash: 'Crash Detected',
    collision: 'Collision Detected',
  };
  return map[type] || (type ? type.replace(/_/g, ' ') : 'Noma\'lum hodisa');
}

// Harsh event uchun matnli xabar (faqat video so'rovi muvaffaqiyatsiz bo'lsa, zaxira sifatida)
function formatHarshEventText(e, vehicle, driver) {
  return (
    `🔍 <b>Event Detected</b>\n\n` +
    `⚙️ Type: <b>${eventTypeLabel(e.event_type)}</b>\n\n` +
    `🚚 Vehicle: ${vehicleLabel(vehicle)} - ${driverName(driver)}\n\n` +
    `🕐 ${formatTime(e.start_time || e.time || e.created_at)}\n\n` +
    `📍 Location: ${e.location?.description || (e.location ? `${e.location.lat}, ${e.location.lon}` : 'Here')}\n\n` +
    `⚠️ <i>Video so'ralmadi / muvaffaqiyatsiz bo'ldi</i>`
  );
}

function formatEvent(payload) {
  const action = payload.action || payload.event || 'unknown_event';
  const data = payload.data || payload;

  switch (action) {
    case 'speeding_event_created':
    case 'speeding_event_updated':
    case 'speeding_event': {
      const s = data.speeding_event || data;
      const vehicle = s.current_vehicle || s.vehicle || {};
      const driver = s.current_driver || s.driver;

      const limitMph = kphToMph(s.max_posted_speed_limit_in_kph ?? s.min_posted_speed_limit_in_kph);
      const overMph = kphToMph(s.max_over_speed_in_kph ?? s.avg_over_speed_in_kph);
      const speedMph = (limitMph != null && overMph != null) ? limitMph + overMph : kphToMph(s.max_vehicle_speed);

      return (
        `🚨 <b>Severe Speeding Alert</b>\n\n` +
        `🚚 Vehicle: ${vehicleLabel(vehicle)} - ${driverName(driver, s.driver_id)}\n\n` +
        `🏎️ Speed: <b>${speedMph ?? 'n/a'} mph</b>\n\n` +
        `🛑 Speed Limit: ${limitMph ?? 'n/a'} mph\n\n` +
        `⚠️ Over Speed: ${overMph ?? 'n/a'} mph\n\n` +
        `📍 ${s.nominatim_location || 'n/a'}\n\n` +
        `🕐 ${formatTime(s.start_time)}`
      );
    }

    case 'unidentified_driving': {
      const u = data.unidentified_driving_event || data;
      return (
        `❓ <b>Unidentified Driving Detected</b>\n\n` +
        `🚚 Vehicle: ${vehicleLabel(u.vehicle)}\n\n` +
        `🕐 ${formatTime(u.start_time)}`
      );
    }

    case 'dvir_created':
    case 'dvir_defect': {
      const d = data.inspection_report || data;
      return (
        `🔧 <b>DVIR / Inspection Report</b>\n\n` +
        `🚚 Vehicle: ${vehicleLabel(d.vehicle)}\n\n` +
        `Status: ${d.status || 'n/a'}\n\n` +
        (d.defects?.length ? `Defects: ${d.defects.length}` : '')
      );
    }

    case 'hos_violation':
    case 'compliance_violation': {
      const c = data.violation || data;
      return (
        `🚨 <b>HOS Violation</b>\n\n` +
        `Driver: ${driverName(c.driver)}\n\n` +
        `Type: ${c.type || c.violation_type || 'n/a'}`
      );
    }

    default: {
      const pretty = JSON.stringify(data, null, 2).slice(0, 1500);
      return `📦 <b>Motive hodisasi: ${action}</b>\n<pre>${pretty}</pre>`;
    }
  }
}

// ------------------ Webhook handler ------------------

const HARSH_EVENT_ACTIONS = ['vehicle_harsh_event', 'harsh_event', 'crash_event', 'collision_event'];

app.post('/webhook/motive', async (req, res) => {
  res.status(200).send('ok'); // Motive'ga tez javob beramiz

  try {
    const providedSecret = req.headers['x-motive-secret'] || req.query.secret;
    if (MOTIVE_WEBHOOK_SECRET && providedSecret !== MOTIVE_WEBHOOK_SECRET) {
      console.warn('Webhook rad etildi: secret mos kelmadi');
      return;
    }

    console.log('Kelgan xom (raw) payload:', JSON.stringify(req.body));

    const action = req.body.action || req.body.event || 'unknown_event';
    const data = req.body.data || req.body;

    // ── 1) Harsh event / crash — video so'raymiz, matn yubormaymiz ──
    if (HARSH_EVENT_ACTIONS.includes(action)) {
      const e = data.harsh_event || data.crash_event || data;
      const vehicle = e.vehicle || {};
      const driver = e.driver || vehicle.current_driver;
      const startTime = e.start_time || e.time || e.created_at || new Date().toISOString();

      try {
        await requestVideoRecall({
          vehicleNumber: vehicle.number,
          startTimeIso: startTime,
          context: {
            eventType: e.event_type,
            vehicleLabel: vehicleLabel(vehicle),
            driverLabel: driverName(driver),
            time: startTime,
            location: e.location,
          },
        });
      } catch (err) {
        console.error('Video so\'rovi muvaffaqiyatsiz, matnga o\'tildi:', err.message);
        await sendTelegramMessage(formatHarshEventText(e, vehicle, driver));
      }
      return;
    }

    // ── 2) Video tayyor bo'lganda — videoni (yoki muvaffaqiyatsiz bo'lsa matnni) yuboramiz ──
    if (action === 'video_recall_request_completed') {
      const r = data.video_recall_request || data;
      const recallId = String(r.id || req.body.id || '');
      const context = pendingRecalls.get(recallId);
      pendingRecalls.delete(recallId);

      const cameras = r.cameras || [];
      const videos = cameras.filter(c => c.download_url);

      const caption =
        `🔍 <b>Event Detected</b>\n\n` +
        `⚙️ Type: <b>${eventTypeLabel(context?.eventType)}</b>\n\n` +
        `🚚 Vehicle: ${context?.vehicleLabel || vehicleLabel(r.vehicle)} - ${context?.driverLabel || ''}\n\n` +
        `🕐 ${formatTime(context?.time)}\n\n` +
        `📍 Location: ${context?.location?.description || (context?.location ? `${context.location.lat}, ${context.location.lon}` : 'Here')}`;

      if (videos.length === 0) {
        await sendTelegramMessage(`${caption}\n\n⚠️ <i>Video topilmadi</i>`);
        return;
      }

      for (const cam of videos) {
        await sendTelegramVideo(cam.download_url, `${caption}\n\n📹 ${cam.position || ''}`);
      }
      return;
    }

    // ── 3) Qolgan barcha hodisalar — oddiy matn ──
    const message = formatEvent(req.body);
    await sendTelegramMessage(message);
  } catch (err) {
    console.error('Motive webhookni qayta ishlashda xato:', err);
  }
});

app.get('/', (_req, res) => res.send('Motive → Telegram bot ishlayapti.'));

app.listen(PORT, () => {
  console.log(`✅ Server ${PORT}-portda ishga tushdi`);
  console.log(`Motive webhook URL: POST http://<domeningiz>:${PORT}/webhook/motive?secret=${MOTIVE_WEBHOOK_SECRET}`);
});

_SECRET}`);
});
