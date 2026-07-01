import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "cmd.exe" : "npm";
const args =
  process.platform === "win32" ? ["/d", "/s", "/c", "npm install"] : ["install"];

const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error(`Failed to start dependency installer: ${result.error.message}`);
}

process.exit(result.status ?? 1);
