/*──────────────────────────────
  智械 GPT 網頁客服 - 完整後端 (index.js)
──────────────────────────────*/
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

/* 📌 你只要在 Vercel「Environment Variables」設定 OPENAI_API_KEY 即可 */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/* 📌 Assistant ID（OpenAI Console 裡複製）*/
const ASSISTANT_ID = "asst_7F67oKHWsCHLZ4tHaNBEmJh7";

/* 使用者 userId ↔ threadId 對照 */
const userThreads = {};

/*───────────────────────────────
  工具：包一層自動偵錯的 fetch
───────────────────────────────*/
async function fetchWithCheck(url, options, res) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    /* ⬇️ 版本錯誤偵測 */
    const msg = data?.error?.message || "Unknown error";
    if (
      msg.includes("has been deprecated") ||
      msg.includes("invalid_beta") ||
      msg.includes("assistants=v1")
    ) {
      console.error(
        "🚨 OpenAI Assistants API 版本錯誤：請確認 header 'OpenAI-Beta' 是否為 'assistants=v2'"
      );
    } else {
      console.error("❌ API 錯誤：", data);
    }
    /* 若有 res (在 API route 裡) 直接回 500，否則丟出給上層 try/catch */
    if (res) return res.status(500).json({ error: data });
    throw new Error("Fetch failed");
  }

  return data;
}

/*──────────────────────────────
  主要 API：/api/ask
──────────────────────────────*/
app.post("/api/ask", async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) {
    return res.status(400).json({ error: "Missing userId or message" });
  }

  try {
    /* 1️⃣ 取得 (或新建) thread ----------------------------------- */
    let threadId = userThreads[userId];
    if (!threadId) {
      const threadData = await fetchWithCheck(
        "https://api.openai.com/v1/threads",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "assistants=v2",
            "Content-Type": "application/json",
          },
        },
        res
      );
      threadId = threadData.id;
      userThreads[userId] = threadId;
    }

    /* 2️⃣ 把使用者訊息塞進 thread ----------------------------- */
    await fetchWithCheck(
      `https://api.openai.com/v1/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role: "user",
          content: message,
        }),
      }
    );

    /* 3️⃣ 觸發 Assistant 回答 ---------------------------------- */
    const runData = await fetchWithCheck(
      `https://api.openai.com/v1/threads/${threadId}/runs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ assistant_id: ASSISTANT_ID }),
      },
      res
    );
    const runId = runData.id;

    /* 4️⃣ 輪詢直到完成 ----------------------------------------- */
    let status = "queued";
    while (status !== "completed" && status !== "failed") {
      await new Promise((r) => setTimeout(r, 1000));
      const runStatus = await fetchWithCheck(
        `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "assistants=v2",
          },
        },
        res
      );
      status = runStatus.status;
    }

    /* 5️⃣ 取回最後一則 Assistant 訊息 -------------------------- */
    const messagesData = await fetchWithCheck(
      `https://api.openai.com/v1/threads/${threadId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2",
        },
      },
      res
    );
    const lastMessage = messagesData.data.find(
      (m) => m.role === "assistant"
    ) || { content: [{ text: { value: "⚠️ 沒有收到回覆" } }] };

    /* 6️⃣（可選）把對話存到 Google Sheet ----------------------- */
    await fetch(
      "https://script.google.com/macros/s/AKfycbxpd5JUJpL15JDajyzAh_TAG0s9ZxBv6PPxRVVvt0uMLUpfnc1elCSHM0Nxy84tD8Wg/exec",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: message,
          answer: lastMessage.content[0].text.value,
          timestamp: new Date().toISOString(),
        }),
      }
    );

    /* 回傳給前端 */
    return res.json({ reply: lastMessage.content[0].text.value });
  } catch (err) {
    console.error("❌ Server Error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/*──────────────────────────────
  Vercel 需要 export default
──────────────────────────────*/
export default app;
