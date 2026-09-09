import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export function signUserToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    SECRET,
    { expiresIn: "30d" }
  );
}

export function verifyUserToken(token) {
  return jwt.verify(token, SECRET);
}
