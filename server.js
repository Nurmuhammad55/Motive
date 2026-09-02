 const express = require('express');
const fetch = require('node-fetch');

const TELEGRAM_BOT_TOKEN = '8003183519:AAFn48FqRHV5zunKZNyJizU43An0jtgoy4g';
const TELEGRAM_CHAT_ID = '8159788176';
const MOTIVE_WEBHOOK_SECRET = 'Jojo';
const PORT = 3000;

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

// Motive'dan kelgan xabarni o'qiladigan matnga aylantiradi
function formatEvent(payload) {
  const action = payload.action || payload.event || 'unknown_event';
  const data = payload.data || payload;

  switch (action) {
    case 'vehicle_location_updated': {
      const v = data.vehicle || data;
      return (
        `📍 <b>Mashina joylashuvi yangilandi</b>\n` +
        `Mashina: ${v.number || v.id || 'noma\'lum'}\n` +
        (v.location ? `Koordinata: ${v.location.lat}, ${v.location.lon}\n` : '') +
        (v.current_location?.description ? `Manzil: ${v.current_location.description}\n` : '')
      );
    }
    case 'vehicle_harsh_event':
    case 'harsh_event': {
      const e = data.harsh_event || data;
      return (
        `⚠️ <b>Xavfli haydash holati</b>\n` +
        `Turi: ${e.event_type || 'n/a'}\n` +
        `Haydovchi: ${e.driver?.first_name || ''} ${e.driver?.last_name || ''}\n` +
        `Mashina: ${e.vehicle?.number || 'n/a'}\n` +
        (e.location ? `Joylashuv: ${e.location.lat}, ${e.location.lon}\n` : '')
      );
    }
    case 'unidentified_driving': {
      const u = data.unidentified_driving_event || data;
      return (
        `❓ <b>Noma'lum haydovchi aniqlandi</b>\n` +
        `Mashina: ${u.vehicle?.number || 'n/a'}\n` +
        `Boshlangan vaqt: ${u.start_time || 'n/a'}\n`
      );
    }
    case 'dvir_created':
    case 'dvir_defect': {
      const d = data.inspection_report || data;
      return (
        `🔧 <b>DVIR / tekshiruv hisoboti</b>\n` +
        `Mashina: ${d.vehicle?.number || 'n/a'}\n` +
        `Holati: ${d.status || 'n/a'}\n` +
        (d.defects?.length ? `Nosozliklar soni: ${d.defects.length}\n` : '')
      );
    }
    case 'hos_violation':
    case 'compliance_violation': {
      const c = data.violation || data;
      return (
        `🚨 <b>HOS / qoidabuzarlik</b>\n` +
        `Haydovchi: ${c.driver?.first_name || ''} ${c.driver?.last_name || ''}\n` +
        `Turi: ${c.type || c.violation_type || 'n/a'}\n`
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
