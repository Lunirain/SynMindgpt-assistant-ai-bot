import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

const { OPENAI_API_KEY } = process.env;
const ASSISTANT_ID = "asst_7F67oKHWsCHLZ4tHaNBEmJh7";
const GAS_URL =
  "https://script.google.com/macros/s/AKfycbxpd5JUJpL15JDajyzAh_TAG0s9ZxBv6PPxRVVvt0uMLUpfnc1elCSHM0Nxy84tD8Wg/exec";

if (!OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY not set in env!");
}

/** 簡易 in-memory thread 對應表（正式環境可改用 Redis / DB） */
const userThreads = {};

app.post("/api/ask", async (req, res) => {
  if (!OPENAI_API_KEY)
    return res.status(500).json({ error: "Server mis-config: API key missing" });

  const { userId, message } = req.body;
  if (!userId || !message)
    return res.status(400).json({ error: "Missing userId or message" });

  try {
    /* ------------ 1. 取得 / 建立 thread ------------ */
    let threadId = userThreads[userId];
    if (!threadId) {
      const threadRes = await fetch("https://api.openai.com/v1/threads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v1",
          "Content-Type": "application/json",
        },
      });
      if (!threadRes.ok)
        throw new Error(`Create thread failed ${threadRes.status}`);
      const { id } = await threadRes.json();
      threadId = id;
      userThreads[userId] = threadId;
    }

    /* ------------ 2. 將使用者訊息加入 thread ------------ */
    const msgRes = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "user", content: message }),
      }
    );
    if (!msgRes.ok) throw new Error(`Add message failed ${msgRes.status}`);

    /* ------------ 3. 觸發 Assistant Run ------------ */
    const runRes = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/runs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ assistant_id: ASSISTANT_ID }),
      }
    );
    if (!runRes.ok) throw new Error(`Create run failed ${runRes.status}`);
    const { id: runId } = await runRes.json();

    /* ------------ 4. 輪詢等 Assistant 完成 ------------ */
    let status = "queued",
      tryCount = 0;
    while (status !== "completed") {
      if (tryCount++ > 15)
        throw new Error("Run polling timeout (>15s)");

      await new Promise((r) => setTimeout(r, 1000));
      const statRes = await fetch(
        `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "assistants=v1",
          },
        }
      );
      if (!statRes.ok)
        throw new Error(`Check run failed ${statRes.status}`);
      const stat = await statRes.json();
      status = stat.status;
      if (status === "failed")
        throw new Error("Assistant run failed");
    }

    /* ------------ 5. 拿最後一次 Assistant 回覆 ------------ */
    const msgsRes = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v1",
        },
      }
    );
    if (!msgsRes.ok) throw new Error(`Get messages failed ${msgsRes.status}`);
    const msgs = await msgsRes.json();
    const last = msgs.data.find((m) => m.role === "assistant");
    const reply = last?.content?.[0]?.text?.value || "（Assistant 無回覆）";

    /* ------------ 6. 寫入 Google Sheet ------------ */
    fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: message,
        answer: reply,
        timestamp: new Date().toISOString(),
      }),
    }).catch((err) => console.error("Sheet error:", err.message));

    /* ------------ 7. 回傳給前端 ------------ */
    return res.json({ reply });
  } catch (err) {
    console.error("🔴 API Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default app;
