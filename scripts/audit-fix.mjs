import { spawnSync } from "node:child_process";

// Usage: node scripts/audit-fix.mjs [--force]
const npmArgs = ["audit", "fix", ...process.argv.slice(2)];

const command = process.platform === "win32" ? "cmd.exe" : "npm";
const args =
  process.platform === "win32"
    ? ["/d", "/s", "/c", `npm ${npmArgs.join(" ")}`]
    : npmArgs;

const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error(`Failed to start npm audit fix: ${result.error.message}`);
}

process.exit(result.status ?? 1);
