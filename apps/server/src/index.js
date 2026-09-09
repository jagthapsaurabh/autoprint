import "dotenv/config";
import express from "express";
import http from "node:http";
import cors from "cors";
import { Server as SocketIOServer } from "socket.io";

import { authRouter } from "./routes/auth.js";
import { shopRouter } from "./routes/shop.js";
import { publicRouter } from "./routes/public.js";
import { agentRouter } from "./routes/agent.js";
import { paymentRouter } from "./routes/payment.js";

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*" },
});

app.set("io", io);

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", authRouter);
app.use("/api/shop", shopRouter);
app.use("/api/public", publicRouter);
app.use("/api/agent", agentRouter);
app.use("/api/payment", paymentRouter);

// Socket.io: shop dashboards & agents join a room per shop for live job updates
io.on("connection", (socket) => {
  socket.on("join:shop", (shopId) => {
    if (shopId) socket.join(`shop:${shopId}`);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`AutoPrint server listening on http://0.0.0.0:${PORT}`);
});
