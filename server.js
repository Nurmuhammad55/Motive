const express = require('express');
const fetch = require('node-fetch');
const TELEGRAM_BOT_TOKEN = '8003183519:AAFn48FqRHV5zunKZNyJizU43An0jtgoy4g';
const TELEGRAM_CHAT_ID = '8159788176';
const MOTIVE_WEBHOOK_SECRET = 'Jojo';
const PORT = 3000;
const TIMEZONE = 'America/New_York';
const app = express();
app.use(express.json({ limit: '1mb' }));
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
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
  if (!res.ok) {
    const body = await res.text();
    console.error('Telegramga yuborishda xato:', res.status, body);
  }
  return res.ok;
}
function formatTime(isoString) {
  if (!isoString) return 'Noma\'lum vaqt';
  try {
    const d = new Date(isoString);
    const time = d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: TIMEZONE,
      timeZoneName: 'short', // ET / EST / EDT qo'shadi
    });
    const date = d.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      timeZone: TIMEZONE,
    });
    return `${time} ${date}`;
  } catch {
    return isoString;
  }
}

function driverName(driver) {
  if (!driver) return 'Noma\'lum haydovchi';
  const first = driver.first_name || '';
  const last = driver.last_name || '';
  return `${first} ${last}`.trim().toUpperCase() || 'Noma\'lum haydovchi';
}

function vehicleLabel(vehicle) {
  if (!vehicle) return 'Noma\'lum';
  return vehicle.number || vehicle.id || 'Noma\'lum';
}

// Harsh braking / harsh event turlarini chiroyli nomga o'giradi
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

// --- Motive'dan kelgan xabarni o'qiladigan matnga aylantiradi ---
function formatEvent(payload) {
  const action = payload.action || payload.event || 'unknown_event';
  const data = payload.data || payload;

  switch (action) {
    // ── Harsh driving (hard braking / acceleration / turning) ──
    case 'vehicle_harsh_event':
    case 'harsh_event': {
      const e = data.harsh_event || data;
      const vehicle = e.vehicle || {};
      const driver = e.driver || vehicle.current_driver;

      return (
        `🔍 <b>Event Detected</b>\n\n` +
        `⚙️ Type: <b>${eventTypeLabel(e.event_type)}</b>\n\n` +
        `🚚 Vehicle: ${vehicleLabel(vehicle)} - ${driverName(driver)}\n\n` +
        `🕐 ${formatTime(e.start_time || e.time || e.created_at)}\n\n` +
        `📍 Location: ${e.location?.description || (e.location ? `${e.location.lat}, ${e.location.lon}` : 'Here')}`
      );
    }

    // ── Crash / collision ──
    case 'crash_event':
    case 'collision_event': {
      const c = data.crash_event || data;
      const vehicle = c.vehicle || {};
      const driver = c.driver || vehicle.current_driver;

      return (
        `🚨 <b>Crash Detected</b>\n\n` +
        `🚚 Vehicle: ${vehicleLabel(vehicle)} - ${driverName(driver)}\n\n` +
        `🕐 ${formatTime(c.time || c.created_at)}\n\n` +
        `📍 Location: ${c.location?.description || (c.location ? `${c.location.lat}, ${c.location.lon}` : 'Here')}`
      );
    }

    // ── Speeding ──
    case 'speeding_event_created':
    case 'speeding_event_updated':
    case 'speeding_event': {
      const s = data.speeding_event || data;
      const vehicle = s.vehicle || {};
      const driver = s.driver || vehicle.current_driver;
      const speed = s.speed ?? s.recorded_speed;
      const limit = s.posted_speed_limit ?? s.speed_limit;
      const over = (speed != null && limit != null) ? Math.round(speed - limit) : s.over_speed;

      return (
        `🚨 <b>Severe Speeding Alert</b>\n\n` +
        `🚚 Vehicle: ${vehicleLabel(vehicle)} - ${driverName(driver)}\n\n` +
        `🏎️ Speed: <b>${speed ?? 'n/a'} mph</b>\n\n` +
        `🛑 Speed Limit: ${limit ?? 'n/a'} mph\n\n` +
        `⚠️ Over Speed: ${over ?? 'n/a'} mph\n\n` +
        (s.url ? `🔗 <a href="${s.url}">See more</a>` : '')
      );
    }

    // ── Unidentified driving ──
    case 'unidentified_driving': {
      const u = data.unidentified_driving_event || data;
      return (
        `❓ <b>Unidentified Driving Detected</b>\n\n` +
        `🚚 Vehicle: ${vehicleLabel(u.vehicle)}\n\n` +
        `🕐 ${formatTime(u.start_time)}`
      );
    }

    // ── DVIR / inspection ──
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

    // ── HOS / compliance ──
    case 'hos_violation':
    case 'compliance_violation': {
      const c = data.violation || data;
      return (
        `🚨 <b>HOS Violation</b>\n\n` +
        `Driver: ${driverName(c.driver)}\n\n` +
        `Type: ${c.type || c.violation_type || 'n/a'}`
      );
    }

    // ── Video recall tayyor bo'lganda ──
    case 'video_recall_request_completed': {
      const r = data.video_recall_request || data;
      const cameras = r.cameras || [];
      const links = cameras
        .filter(c => c.download_url)
        .map(c => `📹 <a href="${c.download_url}">${c.position || 'Video'}</a>`)
        .join('\n');
      return (
        `🎥 <b>Video Ready</b>\n\n` +
        `🚚 Vehicle: ${vehicleLabel(r.vehicle)}\n\n` +
        (links || 'Video hali tayyor emas.')
      );
    }

    default: {
      const pretty = JSON.stringify(data, null, 2).slice(0, 1500);
      return `📦 <b>Motive hodisasi: ${action}</b>\n<pre>${pretty}</pre>`;
    }
  }
}

// Motive shu manzilga POST yuboradi
app.post('/webhook/motive', async (req, res) => {
  res.status(200).send('ok'); // Motive'ga tez javob beramiz

  try {
    const providedSecret = req.headers['x-motive-secret'] || req.query.secret;

    if (MOTIVE_WEBHOOK_SECRET && providedSecret !== MOTIVE_WEBHOOK_SECRET) {
      console.warn('Webhook rad etildi: secret mos kelmadi');
      return;
    }

    console.log('Kelgan xom (raw) payload:', JSON.stringify(req.body));

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
