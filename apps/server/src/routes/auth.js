import { Router } from "express";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma.js";
import { signUserToken } from "../lib/token.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

authRouter.post("/register/shop", async (req, res) => {
  try {
    const { fullName, email, whatsapp, password, shopName, address, shopWhatsapp } = req.body;
    if (!fullName || !email || !password || !shopName) {
      return res.status(400).json({ error: "fullName, email, password and shopName are required" });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "Email already registered" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { fullName, email, whatsapp, passwordHash, role: "SHOP_OWNER" },
    });

    const shop = await prisma.shop.create({
      data: {
        ownerId: user.id,
        name: shopName,
        address,
        whatsapp: shopWhatsapp || whatsapp,
        shopToken: nanoid(12),
        runtimeKey: nanoid(32),
        upiId: null,
      },
    });

    const token = signUserToken(user);
    res.json({ token, user: publicUser(user), shop });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
});

authRouter.post("/register/student", async (req, res) => {
  try {
    const { fullName, email, whatsapp, password } = req.body;
    if (!fullName || !email || !password) {
      return res.status(400).json({ error: "fullName, email and password are required" });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "Email already registered" });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { fullName, email, whatsapp, passwordHash, role: "STUDENT" },
    });
    const token = signUserToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
});

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });
    const shop = await prisma.shop.findUnique({ where: { ownerId: user.id } });
    const token = signUserToken(user);
    res.json({ token, user: publicUser(user), shop });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const shop = await prisma.shop.findUnique({ where: { ownerId: req.user.id } });
  res.json({ user: publicUser(req.user), shop });
});

function publicUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    whatsapp: user.whatsapp,
    role: user.role,
  };
}
