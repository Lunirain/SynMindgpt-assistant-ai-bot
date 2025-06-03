import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = 'asst_7F67oKHWsCHLZ4tHaNBEmJh7';
const userThreads = {};

app.post('/api/ask', async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) return res.status(400).json({ error: 'Missing userId or message' });

  let threadId = userThreads[userId];
  if (!threadId) {
    const threadRes = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v1',
        'Content-Type': 'application/json',
      },
    });
    const threadData = await threadRes.json();
    threadId = threadData.id;
    userThreads[userId] = threadId;
  }

  await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta': 'assistants=v1',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role: 'user',
      content: message,
    }),
  });

  const runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta': 'assistants=v1',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ assistant_id: ASSISTANT_ID }),
  });

  const runData = await runRes.json();
  const runId = runData.id;

  let status = 'queued';
  while (status !== 'completed' && status !== 'failed') {
    await new Promise(r => setTimeout(r, 1000));
    const runStatusRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v1',
      },
    });
    const runStatus = await runStatusRes.json();
    status = runStatus.status;
  }

  const messagesRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta': 'assistants=v1',
    },
  });
  const messagesData = await messagesRes.json();
  const lastMessage = messagesData.data.find(msg => msg.role === 'assistant');

// 👉 儲存對話到 Google Sheet
await fetch("https://script.google.com/macros/s/AKfycbxpd5JUJpL15JDajyzAh_TAG0s9ZxBv6PPxRVVvt0uMLUpfnc1elCSHM0Nxy84tD8Wg/exec", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    question: message,
    answer: lastMessage.content[0].text.value,
    timestamp: new Date().toISOString()
  })
});

// 回覆 Assistant 給前端
  res.json({ reply: lastMessage.content[0].text.value });
});

export default app;
