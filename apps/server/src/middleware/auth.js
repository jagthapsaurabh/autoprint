import { verifyUserToken } from "../lib/token.js";
import { prisma } from "../lib/prisma.js";

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Login required" });
    const payload = verifyUserToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ error: "Invalid session" });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

// authenticates a local print agent using the shop's runtime key
export async function requireAgent(req, res, next) {
  try {
    const key = req.headers["x-runtime-key"];
    if (!key) return res.status(401).json({ error: "Missing runtime key" });
    const shop = await prisma.shop.findUnique({ where: { runtimeKey: String(key) } });
    if (!shop) return res.status(401).json({ error: "Invalid runtime key" });
    req.shop = shop;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Agent auth failed" });
  }
}
