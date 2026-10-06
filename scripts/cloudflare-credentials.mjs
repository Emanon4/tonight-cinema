import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Prefer explicit CI secrets; locally fall back to the wrangler login token.
export async function cloudflareCredentials() {
  if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)
    return { token: process.env.CLOUDFLARE_API_TOKEN, accountId: process.env.CLOUDFLARE_ACCOUNT_ID };
  const candidates = [
    path.join(os.homedir(), "Library/Preferences/.wrangler/config/default.toml"),
    path.join(os.homedir(), ".config/.wrangler/config/default.toml"),
    path.join(os.homedir(), ".wrangler/config/default.toml"),
  ];
  const file = candidates.find((f) => fs.existsSync(f));
  const token = file && fs.readFileSync(file, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
  if (!token) return null;
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    const r = await fetch("https://api.cloudflare.com/client/v4/accounts", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.result?.length)
      throw Error("Cloudflare 登录已过期或缺少权限，请运行 npx wrangler login。");
    accountId = body.result[0].id;
  }
  return { token, accountId };
}
