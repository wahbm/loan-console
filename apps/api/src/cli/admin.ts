import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createDatabase } from "../db/client.js";
import { loadConfig } from "../config.js";
import { createRepository } from "../repositories/index.js";
import { hashPassword } from "../auth.js";

const config = loadConfig();
const database = config.databaseMode === "mysql" ? createDatabase(config.databaseUrl) : undefined;
const repository = createRepository({ mode: config.databaseMode, database: database?.db, dataDir: config.adminDataDir });
const command = process.argv[2];
const rl = createInterface({ input, output });

async function questionHidden(prompt: string): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function") return rl.question(`${prompt}（当前终端不支持隐藏输入）: `);
  output.write(prompt);
  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      for (const character of text) {
        if (character === "\u0003") process.exit(130);
        if (character === "\r" || character === "\n") {
          input.setRawMode?.(false);
          input.pause();
          input.off("data", onData);
          output.write("\n");
          resolve(value);
        } else if (character === "\u007f") {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    input.setRawMode?.(true);
    input.resume();
    input.on("data", onData);
  });
}

try {
  const username = (await rl.question("管理员用户名: ")).trim();
  const password = await questionHidden("管理员密码: ");
  if (!username || password.length < 12) throw new Error("用户名不能为空，密码至少 12 位");
  const existing = await repository.findUserByUsername(username);
  if (command === "create") {
    if (existing) throw new Error("USERNAME_EXISTS");
    await repository.createUser({ username, passwordHash: await hashPassword(password) });
    console.log("管理员账号已创建");
  } else if (command === "reset-password") {
    if (!existing) throw new Error("USER_NOT_FOUND");
    await repository.updateUserPassword(existing.id, await hashPassword(password));
    await repository.deleteSessionsForUser(existing.id);
    console.log("管理员密码已重置，既有会话已失效");
  } else {
    throw new Error("用法: npm run admin:create 或 npm run admin:reset-password");
  }
} finally {
  rl.close();
  await database?.pool.end();
}
