import { createHmac, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthUser } from "@loan-console/shared";
import type { AppConfig } from "./config.js";
import type { Repository } from "./repositories/types.js";

export const SESSION_COOKIE = "loan_console_session";

function hashToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

function isoAfterSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function parseTime(value: string): number {
  return new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z")).getTime();
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export class AuthService {
  constructor(private readonly repository: Repository, private readonly config: AppConfig) {}

  async login(username: string, password: string, reply: FastifyReply): Promise<AuthUser> {
    const user = await this.repository.findUserByUsername(username);
    if (!user || !(await verifyPassword(user.passwordHash, password))) throw new Error("INVALID_CREDENTIALS");
    const rawToken = randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    await this.repository.createSession({
      id: randomUUID(),
      userId: user.id,
      sessionTokenHash: hashToken(rawToken, this.config.sessionSecret),
      expiresAt: isoAfterSeconds(this.config.sessionMaxTtlSeconds),
      lastSeenAt: now
    });
    reply.setCookie(SESSION_COOKIE, rawToken, {
      httpOnly: true,
      secure: this.config.nodeEnv === "production",
      sameSite: "strict",
      path: "/",
      maxAge: this.config.sessionMaxTtlSeconds
    });
    return { id: user.id, username: user.username };
  }

  async logout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      const session = await this.repository.findSessionByHash(hashToken(token, this.config.sessionSecret));
      if (session) await this.repository.deleteSession(session.id);
    }
    reply.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: this.config.nodeEnv === "production", sameSite: "strict", path: "/" });
  }

  async authenticate(request: FastifyRequest): Promise<AuthUser | null> {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return null;
    const session = await this.repository.findSessionByHash(hashToken(token, this.config.sessionSecret));
    if (!session) return null;
    const now = Date.now();
    const createdAt = parseTime(session.createdAt);
    const absoluteExpiry = createdAt + this.config.sessionMaxTtlSeconds * 1000;
    const currentExpiry = parseTime(session.expiresAt);
    if (now >= Math.min(absoluteExpiry, currentExpiry) || now - parseTime(session.lastSeenAt) > this.config.sessionIdleTtlSeconds * 1000) {
      await this.repository.deleteSession(session.id);
      return null;
    }
    const user = await this.repository.findUserById(session.userId);
    if (!user) return null;
    const nextExpiry = new Date(Math.min(absoluteExpiry, now + this.config.sessionIdleTtlSeconds * 1000)).toISOString();
    await this.repository.touchSession(session.id, new Date(now).toISOString(), nextExpiry);
    return { id: user.id, username: user.username };
  }
}
