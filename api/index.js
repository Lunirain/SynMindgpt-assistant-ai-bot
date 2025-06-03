/* ---------- index.js  (放在 /api/index.js) ----------- */
import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

// === 你的環境變數 ===
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;   // 已在 Vercel → Environment Variables 設定
const ASSISTANT_ID   = 'asst_7F67oKHWsCHLZ4tHaNBEmJh7';

// 用來暫存每個 user 的 threadId（記憶功能）
const userThreads = {};

/** 主要 API：/api/ask  ----------------------------- */
app.post('/api/ask', async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) {
    return res.status(400).json({ error: 'Missing userId or message' });
  }

  try {
    /* 1️⃣ 取得或建立 thread -------------------------------- */
    let threadId = userThreads[userId];
    if (!threadId) {
      const threadRes = await fetch('https://api.openai.com/v1/threads', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v1',
          'Content-Type': 'application/json',
        },
      });
      const threadData = await threadRes.json();
      if (!threadData.id) throw new Error('Failed to create thread');
      threadId = threadData.id;
      userThreads[userId] = threadId;
    }

    /* 2️⃣ 把使用者訊息塞進 thread -------------------------- */
    await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'user', content: message }),
    });

    /* 3️⃣ 觸發 Assistant run ------------------------------ */
    const runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ assistant_id: ASSISTANT_ID }),
    });
    const runData = await runRes.json();
    if (!runData.id) throw new Error('Failed to create run');
    const runId = runData.id;

    /* 4️⃣ 輪詢等待 Assistant 完成 -------------------------- */
    let status = 'queued';
    while (status !== 'completed' && status !== 'failed') {
      await new Promise(r => setTimeout(r, 1000));
      const statRes = await fetch(
        `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            'OpenAI-Beta': 'assistants=v1',
          },
        },
      );
      const statJson = await statRes.json();
      status = statJson.status;
    }

    /* 5️⃣ 取得最後一則 Assistant 訊息 ---------------------- */
    const msgsRes = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v1',
        },
      },
    );
    const msgsJson = await msgsRes.json();

    // 找出 role === 'assistant' 的訊息
    const lastMessage = msgsJson.data.find(m => m.role === 'assistant');

    // --- 容錯抓取文字內容 ---
    let replyText = '[⚠️ Assistant 沒有回覆]';
    if (lastMessage?.content?.length) {
      const textPart = lastMessage.content.find(c => c.type === 'text');
      if (textPart?.text?.value) replyText = textPart.text.value;
      else console.error('⚠️ Assistant 回覆格式非 text.value', lastMessage);
    } else {
      console.error('⚠️ Assistant 沒有 content', lastMessage);
    }

    /* 6️⃣ 寫入 Google Sheet（可自行拿掉） ------------------ */
    await fetch(
      'https://script.google.com/macros/s/AKfycbxpd5JUJpL15JDajyzAh_TAG0s9ZxBv6PPxRVVvt0uMLUpfnc1elCSHM0Nxy84tD8Wg/exec',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: message,
          answer: replyText,
          timestamp: new Date().toISOString(),
        }),
      },
    );

    /* 7️⃣ 回傳給前端 -------------------------------------- */
    return res.json({ reply: replyText });
  } catch (err) {
    console.error('❌ Server Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

/* --------- 讓 Vercel Edge / Serverless 可以 default export --------- */
export default app;
