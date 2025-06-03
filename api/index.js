/*───────────────────────────────────────────────
  智械 GPT 網頁客服　完整後端 (index.js)
───────────────────────────────────────────────*/
import express from 'express';
import fetch    from 'node-fetch';
import dotenv   from 'dotenv';
dotenv.config();

const app            = express();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;   // ← Vercel > Environment Variables
const ASSISTANT_ID   = 'asst_7F67oKHWsCHLZ4tHaNBEmJh7';

app.use(express.json());

// 使用者 id ↔︎ thread id 對照
const userThreads = {};

/*───────────────────────
  主要 API：/api/ask
───────────────────────*/
app.post('/api/ask', async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) {
    return res.status(400).json({ error: 'Missing userId or message' });
  }

  try {
    /* 1️⃣ 取得（或建立）thread --------------------------------------- */
    let threadId = userThreads[userId];

    if (!threadId) {
      const threadRes = await fetch('https://api.openai.com/v1/threads', {
        method : 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta'  : 'assistants=v1',
          'Content-Type' : 'application/json',
        },
        body: JSON.stringify({})               // 建立空 thread
      });

      const threadData = await threadRes.json();
      if (!threadRes.ok) {
        console.error('❌ Create thread failed:', threadData);
        return res.status(500).json({ error: threadData });
      }

      threadId = threadData.id;
      userThreads[userId] = threadId;          // 記錄下來
    }

    /* 2️⃣ 把使用者訊息塞進 thread ----------------------------------- */
    const addMsgRes = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/messages`, {
      method : 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta'  : 'assistants=v1',
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({ role: 'user', content: message })
    });

    const addMsgData = await addMsgRes.json();
    if (!addMsgRes.ok) {
      console.error('❌ Add message failed:', addMsgData);
      return res.status(500).json({ error: addMsgData });
    }

    /* 3️⃣ 觸發 Assistant 回答 -------------------------------------- */
    const runRes = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/runs`, {
      method : 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta'  : 'assistants=v1',
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({ assistant_id: ASSISTANT_ID })
    });

    const runData = await runRes.json();
    if (!runRes.ok) {
      console.error('❌ Run failed:', runData);
      return res.status(500).json({ error: runData });
    }

    const runId = runData.id;

    /* 4️⃣ 輪詢等待回覆完成 ----------------------------------------- */
    let status = 'queued';
    while (status !== 'completed' && status !== 'failed') {
      await new Promise(r => setTimeout(r, 1000));

      const statusRes = await fetch(
        `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta'  : 'assistants=v1',
        },
      });

      const statusData = await statusRes.json();
      status = statusData.status;

      if (!statusRes.ok) {
        console.error('❌ Check run status failed:', statusData);
        return res.status(500).json({ error: statusData });
      }
    }

    /* 5️⃣ 取得最新回覆 --------------------------------------------- */
    const msgRes = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/messages`, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta'  : 'assistants=v1',
      },
    });

    const msgData = await msgRes.json();
    if (!msgRes.ok) {
      console.error('❌ Get messages failed:', msgData);
      return res.status(500).json({ error: msgData });
    }

    const lastMessage = msgData.data.find(m => m.role === 'assistant');
    const answer      = (lastMessage && lastMessage.content[0].text.value) || '⚠️ 沒有收到回覆';

    /* 6️⃣ 寫入 Google Sheet ---------------------------------------- */
    await fetch('https://script.google.com/macros/s/AKfycbxpd5JUJpL15JDajyzAh_TAG0s9ZxBv6PPxRVVvt0uMLUpfnc1elCSHM0Nxy84tD8Wg/exec', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        question  : message,
        answer    : answer,
        timestamp : new Date().toISOString()
      })
    }).catch(err => console.warn('⚠️ Google Sheet failed (可忽略):', err.message));

    /* 7️⃣ 回覆前端 -------------------------------------------------- */
    res.json({ reply: answer });

  } catch (err) {
    console.error('🔥 Server Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/*───────────────────────────────────────────────*/
export default app;
