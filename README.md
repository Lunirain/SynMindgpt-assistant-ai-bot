# GPT Assistants Web Chat (Vercel版)

## 使用說明

1. 將本專案上傳至 Vercel（註冊後可直接部署）
2. 在 Vercel 設定環境變數：`OPENAI_API_KEY`
3. 將你前端的客服 HTML 改為呼叫 `/api/ask` 並附帶 `userId` + `message`
4. 回傳內容將是 Assistant 的回應結果（支援 thread 記憶）
